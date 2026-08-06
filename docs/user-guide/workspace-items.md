# Working with items and workspaces

Workspace Hub keeps applications, websites, locations and support actions as configured items inside a workspace.

## Move to another tab

For Apps, Web apps, Files & places and Daily tools, **Move to Tab…** changes the item assignment inside the current workspace and section. The item keeps its stable ID and metadata. Organisation-managed items cannot be moved.

## Copy to another workspace

**Copy to Workspace…** leaves the source item in place and creates an independent item in the same section of another available workspace. The copy always receives a new stable item ID.

For tabbed sections, choose both the destination workspace and one of its tabs. Help & support is not tabbed, so only a destination workspace is selected.


## Copy complete workspace contents

In **Manage Workspaces**, choose **Copy contents to…** on the source workspace. Select another available workspace and confirm the destructive replacement.

Workspace Hub copies the complete configurable setup: section items, custom tabs, active tab choices, section visibility, icon appearance and workspace status. The target remains the same workspace: its ID, name, organisation, revision, management metadata and archive identity are retained. The source and every other workspace remain unchanged.

Before persistence, Workspace Hub creates a restorepoint of the target. The operation does not switch the active workspace. Use **Workspace History** in the overwritten target to restore its previous contents.

## Move to another workspace

**Move to Workspace…** adds the item to the same section of another available workspace and removes it from the source as one validated library transaction. The original ID is retained unless it already exists anywhere in the destination profile; a collision-safe ID is then generated.

## Safety boundaries

- Transfers use stable workspace, section, item and tab IDs rather than visible names or row positions.
- Source and destination workspaces must both be available and not archived.
- Organisation-managed items cannot be copied or moved.
- Item transfers stay within the same section; cross-section moves and complete-tab transfers are not supported. Complete workspace-content replacement is a separate Manage Workspaces action.
- Copy creates a destination restorepoint before commit.
- Move creates source and destination restorepoints before commit.
- The active workspace is never changed by the transfer itself. If you switch workspaces while a transfer is being committed, the latest committed workspace is used and the visible affected collection is reconciled after the store operation completes.
- A visible source or destination updates immediately after commit; restarting Workspace Hub is not required.
- History is written only after successful persistence. A history warning means the item transfer succeeded but its history record was incomplete.

The operation does not change profile schema 12 or workspace-library schema 1.
