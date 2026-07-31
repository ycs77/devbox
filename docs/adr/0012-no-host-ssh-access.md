# Do not provide host SSH identity access

Devbox does not mount a host SSH Agent socket, expose host SSH files, or manage a substitute SSH key for Sandboxes. Projects and AI Agents therefore receive no host SSH identity through Devbox; users who need SSH authentication arrange it themselves outside Devbox's supported configuration, deliberately trading private-SSH convenience for a smaller host-capability boundary.
