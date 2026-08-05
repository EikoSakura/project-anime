# Project: Anime

A fiction-first framework that uses anime as a medium to run any game or world. A game system for Foundry Virtual Tabletop V14.

## Install

Paste the manifest URL into Foundry's Install System dialog:

```
https://github.com/EikoSakura/project-anime/releases/latest/download/system.json
```

## Distance

Distance is measured from you to your target, token edge to token edge. The bands change at 1, 3, 6, and 12 grid squares of the scene's distance setting, on any grid or none.

| Distance | Rank | Reach |
| --- | --- | --- |
| Engaged | E | You can touch it. |
| Near | D | A few strides away. |
| Far | C | Across the field. |
| Distant | B | Across the battlefield. |
| Sight | A | Anything you can see. |
| Beyond | S | Sight does not limit it. |

Dragging a token names the Distance moved from the drag origin and counts the thresholds crossed, with faint threshold rings around the origin. With one token controlled, hovering another visible token draws a range line named and tinted by the Distance between them. Display only; nothing is enforced. `game.system.api.getDistance(tokenA, tokenB)` returns units, key, and label.
