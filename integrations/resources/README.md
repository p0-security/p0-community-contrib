# Custom Resource Integrations

This directory contains **community-contributed resource integrations** for the [Custom Resource integration](https://docs.p0.dev/integrations/resource-integrations/custom-resource).

Custom resource integrations enable access workflows for third-party tools not natively supported by P0 Security. By implementing the P0 Custom Resource Integration API, contributors can extend access controls to any system of their choice.

---

## Requirements for Contributions

✅ Implement the [P0 Custom Resource Integration API](https://docs.p0.dev/integrations/resource-integrations/custom-resource)  
✅ Written in any language supported by **GCP Cloud Run** and/or **AWS Lambda**  
✅ Include a working `Dockerfile` so the integration can be built and published from this repository  
✅ No additional deployment scripts or CI/CD pipelines — P0 Security will handle publishing the Docker images  
✅ Follow the Apache 2.0 license  
✅ Provide a clear `README.md` inside your integration folder explaining usage, environment variables, and example configurations

---

## Repository Layout

Each custom resource integration should follow this pattern:

```plaintext
integrations/
  <integration-name>/
    Dockerfile
    src/ (source code)
    README.md (usage and configuration instructions)
```

P0 Security will use GitHub Actions in this repository to build and publish your Dockerfile to the [p0-community-contrib DockerHub repo](https://hub.docker.com/r/p0security/p0-community-contrib).
