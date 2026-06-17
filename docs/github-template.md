# GitHub Template Repository

> **Template bootstrap doc.** Use while setting up a new repo from this template. Delete this file or merge any project-specific steps into README / Vault notes once setup is done, unless it still adds maintainer value.

## Recommended development flow

After generating a repo from this template, use this default order:

```txt
Vault notes -> PRD -> Issues -> implement -> ci/check -> release -> save learnings
```

In practice:

1. Create Vault notes under `4_Project/<ProjectName>/`.
2. Add `CONTEXT.md`, `README.md`, `ROADMAP.md`, `Docs/`, `Issues/`, and `Progress/`.
3. Write the PRD in `Docs/`.
4. Split approved issue files into `Issues/`.
5. Implement in the OSS repo created from this template.
6. Run CI and package checks before release.
7. Save release notes and follow-up decisions back to the Vault project.

Enable template mode on the source repository:

```txt
GitHub repo → Settings → General → Template repository
```

Create a public repository from the template:

```bash
gh repo create OWNER/new-pi-extension \
  --public \
  --template OWNER/pi-extension-template \
  --clone
```

Create a private repository from the template:

```bash
gh repo create OWNER/new-pi-extension \
  --private \
  --template OWNER/pi-extension-template \
  --clone
```

Include all branches if needed:

```bash
gh repo create OWNER/new-pi-extension \
  --public \
  --template OWNER/pi-extension-template \
  --include-all-branches \
  --clone
```

After creation:

```bash
cd new-pi-extension
npm install
npm run ci
```\n