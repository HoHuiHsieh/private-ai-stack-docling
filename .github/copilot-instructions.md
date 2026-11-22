# Docling service

This is the standalone Docling Compose repository inside `private-ai-stack/services/docling`.

- The deployment skill is `.github/skills/deploy-bare-metal/SKILL.md`.
- Never read or print secrets from `env/.env.docling-mcp`, `env/.env.docling`, or other filled env files. Read only `*.example` templates and `env/.env.dev`.
- Keep shared JWT settings aligned with agent-service and `INTERNAL_API_TOKEN` aligned with the LINE service.
- Do not add `ports:` or services and do not remove the NVIDIA GPU reservation without approval.
- The service joins the root `private-ai-stack_backend` network. docling-mcp talks to Docling at `http://docling:5001` and LINE at `http://line:3000`.
- Do not start containers until the user approves the first start.
- Use container commands for validation and verification; report actual HTTP and container states.