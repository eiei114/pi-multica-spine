# Repository Settings

> **Template bootstrap doc.** Use while configuring GitHub About, topics, and branch protection after generating a repo. Delete this file or merge needed settings into README once setup is done, unless it still adds maintainer value.

Use this file after creating a real repository from the template.

## GitHub About

Suggested fields:

- Description: one-line pitch for the Pi package
- Website: npm package URL or project docs URL
- Topics:
  - `pi`
  - `pi-package`
  - `agent-skill`
  - `typescript`

## Template mode

If this repository itself should be reusable as a template:

```txt
Settings → General → Template repository
```

## Branch protection

Recommended for public packages:

- Require pull request before merging
- Require status checks to pass
- Require `CI` workflow
- Block force pushes on the default branch

## npm package page

After first publish:

- Confirm README renders correctly
- Confirm package provenance appears
- Confirm package contents are intentional
- Add npm URL to GitHub About and README