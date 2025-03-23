# Roll Pangolin

This is a helper Docker image which helps to deploy [Pangolin Reverse Proxy](https://github.com/fosrl/pangolin) setting with the help of Docker Labels.  

## Usage
1. Add labels to the stack you wanted to expose (also ensure your target container is in the newt network, roll-pangolin needs only access to your pangolin host and your local Docker socket for checking the label)  
For example: 
```
services:
  nginx:
    image: nginx:latest
    labels:
      - "roll-pangolin.enabled=true"
      - "roll-pangolin.destination=http://nginx:80"
      - "roll-pangolin.name=nginx" //This will be the name of the Resource 
      - "roll-pangolin.exposed-path=https://nginx.lab.example.com" //Make sure the example.com is set 
```

2. Run the docker compose with the following docker compose.  
`Roll-pangolin` is a one-off runner, not a deamon service, you can run it when needed.
```
services:
  roll-pangolin:
    image: ghcr.io/huzky-v/roll-pangolin:latest
    environment:
      - EMAIL=YOUR-LOGIN-EMAIL
      - PASSWORD=YOUR-LOGIN-PASSWORD
      - HOST=YOUR-PANGOLIN-ENDPOINT
      - ORGANIZATION=YOUR-ORGANIZATION-SELECTION 
      - DEFAULT_SITE=YOUR-SITE // This is the site name column (look something like immaterial-calabar-python) on the "Manage sites" page
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock // This is needed to get the labels on the Docker host
```

You can see the example on demo.service.yaml  

I will finish the documentation afterwards.

## Known Limitations & Cautions
1. Any changes on Pangolin UI will be discarded after the re-deployment of roll-pangolin 
  - It performs a create-after-delete action for the exposed domain
2. No 2FA support, just plain username / password
  - Or you can pre-login using curl
3. *Tested on single machine setup and my environment only, test yours before you go prod*
  - I have a wildcard subdomain set on Cloudflare beforehead
4. Sub-domain and http/https mode only
5. This is an early stage development.
6. roll-pangolin does not support deleting the old exposed stuff after removing the label on container or setting enabled=false.
  - Will add it back (may be deleting the resource)
7. This is a hobby project to me, may update irregularly, feel free to fork it.
