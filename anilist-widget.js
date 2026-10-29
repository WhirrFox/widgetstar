(async () => {
    const WS = createWS();
    const settings = WS.settings;

    const cacheApi = window.location.host == "widget.st"
    let useCache = false;
    if (cacheApi) {
        if (sessionStorage.getItem("anilist-settings") &&
            (JSON.parse(sessionStorage.getItem("anilist-settings")).custom_css != settings.custom_css)) {
            useCache = true
        }

        sessionStorage.setItem("anilist-settings", JSON.stringify(settings))
    }

    async function getUserId() {
        const request = await WS.fetch("https://graphql.anilist.co", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
            },
            body: JSON.stringify({
                variables: {
                    username: settings.username,
                },
                query: `
                query UserID($username: String) {
                    User(name: $username) {
                        id
                    }    
                }`
            })
        })
        if (!request.ok) {
            if (request.status == 429) {
                throw new Error("Rate Limit, please try again later")
            }
        }
        const json = await request.json()
        if (json.errors) {
            if (json.errors[0].status == 404) {
                throw new Error("User not found (check if you entered the username correct)")
            } else {
                throw new Error(json.errors[0]);
            }
        }
        return json.data.User.id
    }

    function getActivityType() {
        if (settings.show_anime && settings.show_manga)
            return "MEDIA_LIST"
        if (settings.show_anime) return "ANIME_LIST"
        if (settings.show_manga) return "MANGA_LIST"
        throw new Error("At least one option has to be picked")
    }

    async function getLatestActivity() {
        for (let page = 0; page < 10; page++) {
            const request = await WS.fetch("https://graphql.anilist.co", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json",
                },
                body: JSON.stringify({
                    variables: {
                        userId: userId,
                        page: page,
                        perPage: 20,
                        sort: "ID_DESC",
                        activityType: getActivityType()
                    },
                    query: `
              query Page($page: Int, $perPage: Int, $userId: Int, $sort: [ActivitySort], $activityType: ActivityType) {
                Page(page: $page, perPage: $perPage) {
                  activities(userId: $userId, sort: $sort, type: $activityType) {
                    ... on ListActivity {
                      status
                      progress
                      createdAt
                      media {
                        type
                        title {
                          english
                          romaji
                          native
                        }
                        siteUrl
                        coverImage {
                          medium
                        }
                      }
                    }
                  }
                }
              }
              `,
                }),
            });
            if (!request.ok) {
                if (request.status == 429) {
                    throw new Error("Rate Limit, please try again later")
                }
            }
            const json = await request.json();
            if (json.error) {
                throw json.error;
            }
            for (let activity of json.data.Page.activities) {
                if (shouldShowActivity(activity))
                    return activity;
            }
        }
        throw new Error("No activity after 10 tries");
    }

    function shouldShowActivity(activity) {
        if (activity.status.includes("watched") || activity.status.includes("read")) {
            return settings.show_watched_read
        } else if (activity.status.includes("completed")) {
            return settings.show_completed_activity
        } else if (activity.status.includes("plan")) {
            return settings.show_planning_activity
        } else if (activity.status.includes("paused")) {
            return settings.show_paused_activity
        } else if (activity.status.includes("dropped")) {
            return settings.show_dropped_activity
        }

        return true
    }

    function createStylesheet(shadowRoot) {
        const stylesheet = new CSSStyleSheet()
        stylesheet.replaceSync(`
            .anilist-container {
                font: 14px arial, sans-serif;
                display: flex;
                gap: 1rem;
            }
            .anilist-title {
                display: block;
                font-size: large;
                font-weight: bold;
                max-width: 12rem;
                padding-bottom: .5rem;
                padding-top: .25rem;
            }
            .anilist-status {
                padding-bottom: .125rem;
            }
            .anilist-time {
                font-style: oblique;
            }

            ${settings.custom_css ?? ""}
        `)
        return stylesheet
    }

    function createWidget(activity) {
        const mediaTitle = activity.media.title[settings.language] ?? activity.media.title.romaji

        const container = document.createElement("div")
        container.className = "anilist-container"


        if (settings.show_cover_art) {
            let coverA
            if (settings.link_to != "none") {
                coverA = document.createElement("a")
                coverA.className = "anilist-cover-a"
                coverA.href = getHref(activity)
                coverA.target = "_blank"
                container.appendChild(coverA)
            }

            const cover = document.createElement("img")
            cover.className = "anilist-cover"
            cover.alt = mediaTitle
            cover.src = activity.media.coverImage.medium
            if (settings.link_to == "none") {
                container.appendChild(cover)
            } else {
                coverA.appendChild(cover)
            }
        }

        const content = document.createElement("div")
        content.className = "anilist-content"
        container.appendChild(content)

        const title = document.createElement(settings.link_to == "none" ? "div" : "a")
        title.className = "anilist-title"
        title.textContent = mediaTitle
        if (settings.link_to != "none") {
            title.href = getHref(activity)
            title.target = "_blank"
        }
        content.appendChild(title)

        const status = document.createElement("div")
        status.className = "anilist-status"
        status.textContent = `${activity.status} ${activity.progress ?? ""}`;
        content.appendChild(status)

        const time = document.createElement("div")
        time.className = "anilist-time"
        time.textContent = formatDate(activity.createdAt)
        content.appendChild(time)

        WS.element.innerHTML = ""
        const root = document.createElement("div")
        WS.element.appendChild(root)
        const shadowRoot = root.attachShadow({ mode: "open" })
        shadowRoot.appendChild(container)
        shadowRoot.adoptedStyleSheets = [createStylesheet()]
    }

    function getHref(activity) {
        switch (settings.link_to) {
            case "none":
                return ""
            case "profile":
                return `https://anilist.co/user/${settings.username}`
            case "media":
                return activity.media.siteUrl
        }
    }

    function formatDate(timestamp) {
        const date = new Date(timestamp * 1000)
        const options = {
            weekday: "short",
            year: "numeric",
            month: "short",
            day: "numeric",
        };
        switch (settings.activity_time) {
            case "none":
                return ""
            case "relative":
                return getRelativeTime(date)
            case "absolute_date":
                return date.toLocaleDateString(undefined, options)
            case "absolute_time":
                return date.toLocaleTimeString(undefined, options)
        }
    }

    function renderError(error) {
        WS.element.textContent = error
    }

    // https://stackoverflow.com/a/53800501
    const units = {
        year: 24 * 60 * 60 * 1000 * 365,
        month: 24 * 60 * 60 * 1000 * 365 / 12,
        day: 24 * 60 * 60 * 1000,
        hour: 60 * 60 * 1000,
        minute: 60 * 1000,
        second: 1000
    }
    const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
    const getRelativeTime = (d1, d2 = new Date()) => {
        var elapsed = d1 - d2
        for (var u in units)
            if (Math.abs(elapsed) > units[u] || u == 'second')
                return rtf.format(Math.round(elapsed / units[u]), u)
    }


    if (useCache) {
        createWidget(JSON.parse(sessionStorage.getItem("anilist-activity")) ?? await getLatestActivity())
        return
    }

    let userId;
    try {
        userId = await getUserId()
        const activity = await getLatestActivity()
        if (cacheApi) sessionStorage.setItem("anilist-activity", JSON.stringify(activity))
        createWidget(activity);
    } catch (error) {
        renderError(error)
    }
})();