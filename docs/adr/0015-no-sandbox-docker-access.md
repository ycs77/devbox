# Do not expose Docker to Sandboxes

Sandboxes receive neither the host Docker socket nor a nested Docker daemon; Devbox alone manages Sandbox and Service lifecycle from the host through its generated Compose definition. Development tools and AI Agents may edit project Docker artifacts but cannot launch containers from inside a Sandbox, deliberately excluding a host-control capability and avoiding rootless Docker or Docker-in-Docker complexity from the initial product.
