# AGENTS.md

## Product Direction
- The goal of this project is a **barebones PDF viewer in the browser**.
- The UI must stay **intuitive, minimal, and directly useful** for reading PDF content.
- Design should be **out of the way**: no decorative complexity, no unnecessary panels, no visual noise.

## UI Principles (Must Follow)
- Keep controls simple and obvious.
- Prefer a few clear buttons/selects over dense option-heavy toolbars.
- Every control must have a clear purpose tied to reading/viewing the PDF.
- Remove UI elements that are confusing, redundant, or not pertinent to the current feature.
- Preserve maximum reading space (horizontal and vertical).
- Keep labels plain and unambiguous.

## Change Policy
- Any UI change must improve or preserve usability for the barebones viewer goal.
- If a new feature adds complexity, include a simpler default path.
- Default behavior should be predictable with minimal user setup.

## Interaction Style in This Repo
- Prioritize function over appearance.
- Ship the smallest UI that solves the problem well.
- Use simple buttons for primary actions whenever possible.
