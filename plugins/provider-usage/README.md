# Provider usage

Shows usage from enabled usage-source plugins in the sidebar. When a location has
more than one provider, the card opens on an **All** tab that stacks every provider
tab's accounts, each marked with its provider icon. Provider tabs use provider icons,
with pooled accounts stacked under each provider. Each account shows its plan and,
per usage window, a bar, the percent used, and the time until reset.
Codex also shows its available banked resets and the two earliest unexpired
redemption deadlines in Moscow time. These are deadlines to use a saved reset,
not scheduled automatic refreshes. Entries without an expiration are marked as
non-expiring; a collection failure is shown separately from a zero balance.
Clicking a Codex quota row shows the full automatic reset date in Moscow time.
The settings page shows the same banked-reset deadlines.
The card lists account metadata cheaply, then fetches the accounts on the selected
tab. Unopened tabs have no quota badge until measured, and a badge shows only while
that provider's accounts are off screen. Shared sources such as Account Pooler are selected by default; an explicit
machine selection shows that machine’s local usage instead.

An unconfigured shared source remains selectable and shows setup guidance.
Failed refreshes retain the last available measurements with a retry notice.
Account authentication failures and plans without reported limits have separate
states; unavailable usage is never represented as zero consumption.

Settings → Installed plugins → Provider usage contains the usage page, using its
full-size provider groups with email-labeled accounts and fetching only resources in the selected pool or machine. Both surfaces share the plugin’s aggregation and cache. Neither display is required for source
plugins to publish their usage.

Use `bb plugin rpc list --method provider-usage.v1.listResources --json` to find sources
and `bb plugin rpc inspect <plugin-id> provider-usage.v1.listResources --json`
to inspect their published contracts. RPC calls accept JSON through
`--input-file`. See the Plugin Guide for the contract API.

`bb settings usage --json` and `bb.sdk.system.usageLimits()` remain the
host-local provider-maintenance view; they do not aggregate shared pool accounts.
Banked-reset details are available through `provider-usage.v1.getResource` as
the optional `resetCredits` measurement field and through the display plugin's
`getUsage` RPC on each account. Existing sources that omit the field remain
compatible. The host-local maintenance command is unchanged.

Codex, Claude Code, and ACP provider plugins explicitly implement the usage contract
for their own providers. Account Pooler implements it for shared accounts. The
contract is owned here and copied into each source; no additional adapter plugin,
provider-kit helper, or core runtime convention is required. Other providers must
explicitly implement the contract to appear in these displays.

OpenCode's host-local source reports OpenCode Go subscription limits when a Go
Console account or API key is configured on the selected machine. Its five-hour, weekly, and monthly
windows come from Go's usage API. Other providers used through OpenCode and Zen
pay-as-you-go spending are not included.

Known provider-issued account identities are deduplicated within the selected
location. Unknown identities are never merged by email. Structured plan and quota
window metadata give both displays consistent labels.

Provider Usage is enabled by default for newly registered installations. Existing
explicit enable/disable choices are preserved. Right-click the footer shortcut and
choose **Hide** to move it into **More**. Settings → Appearance → Sidebar footer
controls order and visibility for every footer action. The usage settings page
remains available. These preferences belong to BB, not the plugin.
