import net from "net";

// Helper function to parse URLs
export const parseUrl = (urlString) => {
    try {
        const url = new URL(urlString);
        const isIp = net.isIP(url.hostname);
        const hostParts = url.hostname.split(".");

        return {
            protocol: url.protocol.replace(":", ""),
            hostname: url.hostname,
            port: url.port || "default",
            isIp,
            subdomain: isIp ? null : hostParts.length > 2 ? hostParts.slice(0, -2).join(".") : null,
            baseDomain: isIp ? url.hostname : hostParts.slice(-2).join("."),
        };
    } catch {
        console.warn(`⚠️ Invalid URL format: ${urlString}`);
        return null;
    }
};

// Unified API fetch function
export const fetchAPI = async (path, method = "GET", body = null, sessionToken = null, getRaw = false) => {
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

        const response = await fetch(`https://${process.env.HOST}/api/v1/${path}`, options);
        return getRaw?response:response.json();
    } catch (error) {
        console.error(`❌ API request failed: ${method} ${path}`, error);
        return null;
    }
};

function toCamelCase(str) {
    return str.replace(/[-_](.)/g, (_, char) => char.toUpperCase());
}

export const transformLabels = (labels) => {
    let result = {};
    for (let key in labels) {
        if (!key.startsWith("roll-pangolin")) continue;
        let value = labels[key];
        let parts = key.split(/\.|\[|\]/).filter(p => p).map(toCamelCase);
        
        let current = result;
        
        for (let i = 0; i < parts.length; i++) {
            let part = parts[i];
            let isArray = parts[i + 1] && !isNaN(parts[i + 1]);
            let isLast = i === parts.length - 1;
            
            if (isLast) {
                current[part] = value;
            } else {
                if (!current[part]) {
                    current[part] = isArray ? [] : {};
                }
                
                if (isArray) {
                    let index = parseInt(parts[i + 1], 10);
                    if (!current[part][index]) {
                        current[part][index] = {};
                    }
                    current = current[part][index];
                    i++; // Skip the index part
                } else {
                    current = current[part];
                }
            }
        }
    }
    return result["rollPangolin"];
}
