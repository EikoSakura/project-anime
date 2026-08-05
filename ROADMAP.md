# Roadmap

1. **Scaffold** — done. system.json, folder layout (module, templates, styles, lang, fonts), en.json, entry script registering the character actor type and the trait and technique item types with empty TypeDataModels. Installs and loads clean in a new V14 world.
2. **Data models** — done. Character actor plus the two item types, fields from the spec comment blocks.
3. **Item sheets** — done. View and edit modes from the item sheets mockup.
4. **Character sheet, view mode** — done. Layout and styling from the mockup. The Traits and Techniques panels render the embedded items. Fonts bundled locally (Shippori Mincho B1, Zen Kaku Gothic New, both OFL).
5. **Character sheet, edit mode** — done. Title bar toggle, all fields editable. Add creates an embedded item, a card opens its item sheet, delete removes it. Pips, Luck spent, Advancement boxes, and the unspent counter stay clickable in both modes.
6. **Adversary actor type** — done. Desire, Fear, Grade, the five Attributes, Hearts, Energy, embedded Traits and Techniques. Rivals add Luck Dice. Reuse sheet parts.
7. **Packaging** — done. Release zip, manifest and download URLs, install test from the manifest.
8. **Chat cards** — done. Item and roll cards from the chat cards mockup. Post buttons on the item sheet title bar and on each sheet card. Rolls start from an Attribute or Technique name in view mode; the Action Roll dialog picks the second die and a Trait, backed by a real Roll. No Difficulty, no outcome text.
9. **Party folder** — done. A Party folder in the Actors directory, created once per world. The Party HUD shows only the characters inside it (subfolders count), in directory order, instead of every player-owned character. The folder can be renamed or moved; membership follows the folder.
10. **Zone wall tools** — done. Weld Walls and Zone from Walls buttons on the walls toolbar. Weld merges near-miss corners and joins loose ends into other walls, splitting a wall when the junction cannot sit exactly on it. Zone from Walls welds the selection, traces the enclosed interior, and creates the Region with a Zone behavior; when the walls do not close, the open ends are marked and panned to.
