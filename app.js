import Docker from "dockerode";
import net from "net";

const docker = new Docker({ socketPath: "/var/run/docker.sock" });

// Load environment variables
const {
    EMAIL = "",
    PASSWORD = "",
    HOST = "",
    ORGANIZATION = "",
    DEFAULT_SITE = "",
    FORCE_REDEPLOY = "true",
    GROUPING = ""
} = process.env;

const shouldRedeploy = FORCE_REDEPLOY === "true";

if (!EMAIL || !PASSWORD || !HOST || !ORGANIZATION) {
    console.error("❌ Missing required environment variables: EMAIL, PASSWORD, HOST, ORGANIZATION.");
    process.exit(1);
}

const baseDomainData = {};
const siteData = {};
const domainData = [];

// Helper function to parse URLs
const parseUrl = (urlString) => {
    try {
        const url = new URL(urlString);
        const isIp = net.isIP(url.hostname);
        const hostParts = url.hostname.split(".");

        return {
            protocol: url.protocol.replace(":", ""),
            hostname: url.hostname,
            port: url.port || "default",
            isIp,
            subdomain: isIp ? "none" : hostParts.length > 2 ? hostParts.slice(0, -2).join(".") : "none",
            baseDomain: isIp ? url.hostname : hostParts.slice(-2).join("."),
        };
    } catch {
        console.warn(`⚠️ Invalid URL format: ${urlString}`);
        return null;
    }
};

// Unified API fetch function
const fetchAPI = async (path, method = "GET", body = null, sessionToken = null, getRaw = false) => {
    try {
        const options = {
            method,
            headers: {
                "Content-Type": "application/json",
                "X-Csrf-Token": "x-csrf-protection"
            },
        };
        if (sessionToken) options.headers.cookie = sessionToken;
        if (body) options.body = JSON.stringify(body);

        const response = await fetch(`https://${HOST}/api/v1/${path}`, options);
        return getRaw?response:response.json();
    } catch (error) {
        console.error(`❌ API request failed: ${method} ${path}`, error);
        return null;
    }
};

// Retrieve Docker container labels
const getContainerLabels = async () => {
    try {
        const containers = await docker.listContainers({ all: true });

        return containers
            .filter(({ Labels }) =>
                Labels["roll-pangolin.destination"] &&
                Labels["roll-pangolin.enabled"] === "true" &&
                Labels["roll-pangolin.exposed-path"] &&
                ((DEFAULT_SITE && Labels["roll-pangolin.site"]) || DEFAULT_SITE !== "") &&
                (!GROUPING || Labels["roll-pangolin.grouping"])
            )
            .map(({ Labels, Names }) => {
                const parsedDestination = parseUrl(Labels["roll-pangolin.destination"]);
                const parsedExposedPath = parseUrl(Labels["roll-pangolin.exposed-path"]);

                if (!parsedDestination || !parsedExposedPath) return null;

                const destinationPort = parsedDestination.port === "default"
                    ? parsedDestination.protocol === "https" ? "443" : "80"
                    : parsedDestination.port;

                baseDomainData[parsedExposedPath.baseDomain] = "";
                domainData.push(parsedExposedPath.hostname);
                return {
                    site: DEFAULT_SITE || Labels["roll-pangolin.site"],
                    baseDomain: parsedExposedPath.baseDomain,
                    resource: {
                        name: Labels["roll-pangolin.name"] || Names[0],
                        subdomain: parsedExposedPath.subdomain,
                        http: true,
                        protocol: "tcp",
                        domainId: null,
                        siteId: null,
                    },
                    target: {
                        ip: parsedDestination.hostname,
                        port: parseInt(destinationPort, 10),
                        method: parsedDestination.protocol,
                        enabled: true,
                    },
                };
            })
            .filter(Boolean);
    } catch (error) {
        console.error("❌ Error fetching container labels:", error);
        return [];
    }
};

// Login and get session cookie
const loginUserAndGetSessionCookie = async () => {
    const result = await fetchAPI(`auth/login`, "POST", { email: EMAIL, password: PASSWORD }, null, true);

    if (result?.statusText === "OK") {
        return result.headers?.getSetCookie?.()[0]?.split(";")[0] || "";
    } else {
        console.error("❌ Login failed:", result?.message);
        process.exit(1);
    }
};

// Main function
const deployResources = async () => {
    const sessionToken = await loginUserAndGetSessionCookie();
    const resourceList = await getContainerLabels();

    if (shouldRedeploy) {
        //get existing resources list for the organization so that the exposed Resources could be compared and deleted
        const existingResources = (await fetchAPI(`org/${ORGANIZATION}/resources`, "GET", null, sessionToken))?.data?.resources || [];
        const resourcesToDelete = existingResources.filter(({ fullDomain }) => domainData.includes(fullDomain));

        await Promise.all(
            resourcesToDelete.map(({ resourceId }) =>
                fetchAPI(`resource/${resourceId}`, "DELETE", null, sessionToken)
            )
        );
    }

    // Get domain IDs (the desired exposed domain) and save it for later use.
    const domainListResponse = await fetchAPI(`org/${ORGANIZATION}/domains`, "GET", null, sessionToken);
    domainListResponse?.data?.domains?.forEach(({ baseDomain, domainId }) => {
        domainData[baseDomain] = domainId;
    });

    // Get all site (wireguard connected machine) from the list of the labels defined 
    const siteNames = [...new Set(resourceList.map(({ site }) => site))];
    const siteRequests = siteNames.map((site) => fetchAPI(`org/${ORGANIZATION}/site/${site}`, "GET", null, sessionToken));
    const siteResponses = await Promise.all(siteRequests);

    siteResponses.forEach((response, index) => {
        if (response?.data?.siteId) {
            siteData[siteNames[index]] = response.data.siteId;
        }
    });

    // Create resources and targets
    for (const resourceItem of resourceList) {
        try {
            const siteId = siteData[resourceItem.site];
            resourceItem.resource.siteId = siteId;
            resourceItem.resource.domainId = domainData[resourceItem.baseDomain];

            const createResponse = await fetchAPI(`org/${ORGANIZATION}/site/${siteId}/resource/`, "PUT", resourceItem.resource, sessionToken);
            const resourceId = createResponse?.data?.resourceId;
            if (!resourceId) continue;

            await fetchAPI(`resource/${resourceId}/target`, "PUT", resourceItem.target, sessionToken);
            console.log(`✅ Created resource: ${resourceItem.resource.name}`);
        } catch (error) {
            console.error(`❌ Error creating resource: ${resourceItem.resource.name}`, error);
        }
    }
};

// Run the deployment
deployResources();