# GitHub

GitHub with a personal access token, browser sign-in or a device code.

Maintained independently from [Switchboard](https://github.com/tader/switchboard).

## Installation

Open **Plugins → Community** in Switchboard and install **GitHub**. Alternatively use **Install from GitHub** with repository `tader/switchboard-plugin-github` and path `plugins/github`. Review the dependency preview and apply it.

Dependencies: `oauth2` (^1.0.0), `api-key` (^1.0.0). Missing external dependencies are resolved through the live community catalog; OAuth and API Keys are built into Switchboard.

## Existing installations

Install this repository before upgrading a Switchboard instance that bundles `github`. The plugin ID, service IDs, authentication methods, settings and persistent data paths are preserved. Installed plugins replace the built-in copy. Existing connections and saved calls continue to work; keep the instance data directory and encryption key.

## Activity previews

With preview storage enabled in Switchboard 0.17.0, an audited, query-free `GET https://api.github.com/user` can retain the top-level account `type` string, up to 32 bytes. This applies to personal access token, browser sign-in and device code connections. Login, email and plan details are outside the projection. The sign-in account lookup is outside activity capture. [GitHub authenticated user response](https://docs.github.com/en/rest/users/users#get-the-authenticated-user)

## Development

Use Node.js 24 or newer. Run `npm ci` and `npm run check`. The plugin folder includes local type declarations, so development does not require a Switchboard checkout. Type imports are erased at runtime; shared helpers are provided by `ctx.require()` and the manifest declares compatible versions.

Keep `plugin.json` and `package.json` versions in sync. Commit version changes before tagging a release; `gh release create` does not bump versions. Switchboard follows the branch, tag or commit selected during installation.

To verify the preview with synthetic responses, check out Switchboard v0.17.0 and run `npm ci` there. From this plugin repository, run `SWITCHBOARD_CORE_DIR=../switchboard node --test test/activity-output.test.mjs`. The test provisions disposable preview storage and uses the core auth helpers and audited request path.

## Releases

Release-please opens version and changelog pull requests from Conventional Commits. Merge the release PR to publish its tag and GitHub release. Plugin manifests are updated with their package versions. Family repositories maintain an independent version for each plugin.
