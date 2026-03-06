# AoE Easy Resolve (PF2e)

**AoE Easy Resolve** streamlines the clunky, multi-step process of resolving Area of Effect spells, bombs, and abilities in the Pathfinder 2e system. 

Simply place a measured template (burst, cone, line, or emanation) from an item card, and the module instantly generates an interactive chat card. From this single card, players can roll their own saves, GMs can batch-roll NPC saves, and damage and effects are distributed to everyone with perfect accuracy.

## Features

* **Instant Target Acquisition:** Placing a measured template automatically detects all tokens caught in the blast and adds them to a centralized chat card.
* **Player-Empowered Saving Throws:** Players can click the "Save" button next to their character's name to roll their saving throw. The results are securely routed to the GM to update the master chat card.
* **1-Click NPC Rolls:** GMs have a "Roll NPCs" button that instantly rolls saving throws for all non-player tokens caught in the area, bypassing annoying popup dialogs.
* **Native IWR & Evasion Integration:** Uses the PF2e system's native rolling and damage APIs. Immunities, Weaknesses, Resistances, and Degree of Success adjustments (like Evasion or Juggernaut) are calculated flawlessly.
* **Automatic Effect Application:** Configure items to automatically apply specific conditions or effects (via Compendium UUID) based on the target's degree of success.
* **Custom Damage Overrides:** Perfect for alchemical bombs or Starfinder 2e grenades. Bypass an item's standard damage profile and inject your own custom damage formulas and damage types.
* **Tidy Cleanup:** Once damage is applied, the GM is prompted to easily delete the measured template from the canvas.

---

## How It Works

1. **Cast the Spell:** A player or GM clicks the template icon (Burst, Cone, Line, etc.) on a spell or item's chat card.
2. **Place the Template:** The user places the template on the canvas.
3. **The Resolve Card Appears:** A new chat message is generated listing every token caught in the area. 
4. **Roll Damage:** The caster clicks "Roll Damage" to establish the base damage for the AoE.
5. **Roll Saves:** Players click "Save" next to their names. The GM clicks "Roll NPCs" to handle the rest.
6. **Apply:** The GM clicks "Apply Damage & Effects". The module calculates Basic Save multipliers (or your custom multipliers), checks IWR, distributes the damage, applies any configured conditions, and prompts to delete the template.

---

## Item Configuration

This module adds a new **AoE Easy Resolve** configuration section to the bottom of the `Details` tab for Spells, Feats, Actions, Weapons, Consumables, and Equipment. 

This allows you to highly customize how specific items behave when their templates are placed:

### General Settings
* **Ignore AoE Automation:** Check this for utility spells (like *Wall of Stone* or *Obscuring Mist*) to completely disable the AoE save card from generating when the template is placed.
* **Override System Save / Save Type / Custom DC:** Manually force the AoE card to use a specific save type and DC, ignoring the system's default calculations.

### Custom Damage Override
* **Use Custom Damage:** Check this to bypass the item's standard damage roll. 
* **Formula & Damage Type:** Input a custom dice formula (e.g., `3d6 + 4`) and select a damage type from the dropdown. *Perfect for grenades and alchemical items that don't use standard spellcasting damage blocks.*

### Apply Effects
Automatically apply conditions or status effects based on how the target rolled.
* Paste the **Document UUID** (e.g., `Compendium.pf2e.conditionitems.Item.yblD8fOR1J8rDTOW`) of the effect into the corresponding Degree of Success field (Critical Success, Success, Failure, Critical Failure).

### Damage Multipliers
By default, the module assumes standard PF2e "Basic Save" math (Crit Success = 0, Success = 0.5, Failure = 1, Crit Fail = 2). 
* If a spell behaves differently (e.g., *takes full damage on a success*), you can input custom multiplier numbers into these fields to override the default math.

---

## Technical Note on Permissions
To maintain security and prevent players from editing chat messages they don't own, this module utilizes a "Whisper Router." When a player clicks "Save" or "Roll Damage," their client securely whispers the math to the active GM's client. The GM's client intercepts this hidden whisper, updates the master chat card database, and instantly deletes the whisper to keep the chat log clean. 

*Note: A GM must be actively logged into the world for player saves to update the chat card.*

---

