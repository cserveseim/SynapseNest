# GitHub from this VPS

This machine pushes `main` with a dedicated SSH deploy key:

- private: `/home/nexus/.ssh/github_synapsenest` (not in Git)
- public: `deploy/github-deploy-key.pub`
- helper: `/home/nexus/bin/synapsenest-git-push`

Register the public key once as a write deploy key on
`cserveseim/SynapseNest` (Settings → Deploy keys → Allow write access).
After that, pushes do not need a browser session.
