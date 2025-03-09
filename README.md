# Roll Pangolin

This is a helper Docker Container which helps to deploy [Pangolin Reverse Proxy](https://github.com/fosrl/pangolin) setting with the help of Docker Labels.  

## Usage
1. Add the label to the stack you want to expose your service (also ensure your container is in the newt network)
```
services:
  nginx:
    image: nginx:latest
    labels:
      - "roll-pangolin.enabled=true"
      - "roll-pangolin.destination=http://nginx:80"
      - "roll-pangolin.exposed-path=https://nginx.lab.example.com"
```

2. Run the docker compose with the following docker compose
```
services:
  roll-pangolin:
    image: ghcr.io/huzky-v/roll-pangolin:latest
    environment:
      - EMAIL=YOUR-LOGIN-EMAIL
      - PASSWORD=YOUR-LOGIN-PASSWORD
      - HOST=YOUR-PANGOLIN-ENDPOINT
      - ORGANIZATION=YOUR-ORGANIZATION-SELECTION
      - DEFAULT_SITE=YOUR-SITE // This is the site name (look something like immaterial-calabar-python) column on the manage sites page
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock // This is needed
```

I will finish up the documentation afterwards.

## Limitations
1. Any changes on Pangolin UI will be discarded after the re-deployment of roll-pangolin 
  - It performs a create-after-delete action for the exposed domain
2. roll-pangolin does not support deleting the old exposed stuff after removing the label on container or setting enabled=false.
  - Will add it back (may be deleting the resource)
3. No 2FA support, just plain username / password
4. *Tested only on single machine setup and my environment*
5. Sub-domain mode only
6. This is an early stage development, use with caution, I will re-check
7. It should be more, let me think of it.
