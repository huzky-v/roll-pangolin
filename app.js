import Docker from "dockerode";
import { parseUrl, fetchAPI, transformLabels } from "./util.js";    

const docker = new Docker({ socketPath: "/var/run/docker.sock" });

// Load environment variables
const {
    EMAIL = "",
    PASSWORD = "",
    HOST = "",
    ORGANIZATION = "",
    DEFAULT_SITE = "",
    FORCE_REDEPLOY = "true",
    GROUPING = "",
    SESSION_TOKEN = ""
} = process.env;

const shouldRedeploy = FORCE_REDEPLOY === "true";

if (!EMAIL || !PASSWORD || !HOST || !ORGANIZATION) {
    console.error("❌ Missing required environment variables: EMAIL, PASSWORD, HOST, ORGANIZATION.");
    process.exit(1);
}

const baseDomainData = {};
const siteData = {};
const domainData = [];

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

// Retrieve Docker container labels
const getContainerLabels = async () => {
    try {
        const containers = await docker.listContainers({ all: true });

        return containers.filter(({ Labels }) => {
                return Object.keys(Labels).some((item) => item.startsWith("roll-pangolin")) //filter out all that is not roll-pangolin target
            })
            .map(({Labels}) => transformLabels(Labels)) // Transform all Labels 
            .filter((item) => {
                // Filters the container that does not fill in the required field
                return item.destination &&
                item.enabled === "true" &&
                item.exposedPath &&
                item.name &&
                ((DEFAULT_SITE && item.site) || DEFAULT_SITE !== "") &&
                (!GROUPING || item.grouping)
            })
            .map(({destination, exposedPath, name, site, ssoPlatformEnabled, password, pincode}) => {
                const parsedDestination = parseUrl(destination);
                const parsedExposedPath = parseUrl(exposedPath);

                if (!parsedDestination || !parsedExposedPath) return null;

                const destinationPort = parsedDestination.port === "default"
                    ? parsedDestination.protocol === "https" ? "443" : "80"
                    : parsedDestination.port;

                baseDomainData[parsedExposedPath.baseDomain] = "";
                domainData.push(parsedExposedPath.hostname);
                return {
                    site: DEFAULT_SITE || site,
                    baseDomain: parsedExposedPath.baseDomain,
                    resource: {
                        name,
                        subdomain: parsedExposedPath.subdomain,
                        http: true,
                        protocol: "tcp",
                        domainId: null, //get from later api call to obtain domainId
                        siteId: null, //get from later api call to obtain siteId
                    },
                    target: {
                        ip: parsedDestination.hostname,
                        port: parseInt(destinationPort, 10),
                        method: parsedDestination.protocol,
                        enabled: true,
                    },
                    ssoPlatformEnabled,
                    password,
                    pincode
                };
            });
    } catch (error) {
        console.error("❌ Error fetching container labels:", error);
        return [];
    }
};

// Main function
const deployResources = async () => {
    
    const sessionToken = (SESSION_TOKEN) ? SESSION_TOKEN : await loginUserAndGetSessionCookie(); // If there is a session token provided, use the session token, otherwise use email/password 
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

            if (resourceItem.password) await fetchAPI(`resource/${resourceId}/password`, "POST", { password: resourceItem.password }, sessionToken);
            if (resourceItem.pincode) await fetchAPI(`resource/${resourceId}/pincode`, "POST", { pincode: resourceItem.pincode }, sessionToken);
            if (resourceItem.ssoPlatformEnabled === "false") await fetchAPI(`resource/${resourceId}/pincode`, "POST", { sso: false }, sessionToken);

            console.log(`✅ Created resource: ${resourceItem.resource.name}`);

        } catch (error) { 
            console.error(`❌ Error creating resource: ${resourceItem.resource.name}`, error);
        }
    }
};

// Run the deployment
deployResources();