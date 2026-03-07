const LEVEL_MATRICES = {
    "-1": { hp: { h: 9, m: 8, l: 6 }, ac: { h: 15, m: 14, l: 12 }, atk: { h: 6, m: 5 }, dmg: { h: 3, m: 2, l: 1 }, save: { h: 5, m: 4, l: 2 }, skill: { h: 5, m: 3 } },
    0:  { hp: { h: 19, m: 15, l: 12 }, ac: { h: 16, m: 15, l: 13 }, atk: { h: 7, m: 6 }, dmg: { h: 5, m: 3, l: 2 }, save: { h: 6, m: 5, l: 3 }, skill: { h: 6, m: 4 } },
    1:  { hp: { h: 25, m: 20, l: 15 }, ac: { h: 16, m: 15, l: 13 }, atk: { h: 8, m: 7 }, dmg: { h: 7, m: 5, l: 3 }, save: { h: 7, m: 6, l: 4 }, skill: { h: 7, m: 5 } },
    2:  { hp: { h: 28, m: 30, l: 23 }, ac: { h: 18, m: 17, l: 15 }, atk: { h: 10, m: 9 }, dmg: { h: 9, m: 7, l: 5 }, save: { h: 8, m: 7, l: 5 }, skill: { h: 8, m: 6 } },
    3:  { hp: { h: 57, m: 44, l: 34 }, ac: { h: 19, m: 18, l: 16 }, atk: { h: 12, m: 11 }, dmg: { h: 12, m: 9, l: 7 }, save: { h: 9, m: 8, l: 6 }, skill: { h: 10, m: 8 } },
    4:  { hp: { h: 76, m: 60, l: 45 }, ac: { h: 21, m: 20, l: 18 }, atk: { h: 13, m: 12 }, dmg: { h: 14, m: 11, l: 9 }, save: { h: 11, m: 10, l: 8 }, skill: { h: 12, m: 10 } },
    5:  { hp: { h: 95, m: 75, l: 55 }, ac: { h: 22, m: 21, l: 19 }, atk: { h: 15, m: 14 }, dmg: { h: 16, m: 13, l: 10 }, save: { h: 12, m: 11, l: 9 }, skill: { h: 13, m: 11 } },
    6:  { hp: { h: 120, m: 95, l: 70 }, ac: { h: 24, m: 23, l: 21 }, atk: { h: 17, m: 16 }, dmg: { h: 19, m: 15, l: 12 }, save: { h: 14, m: 13, l: 11 }, skill: { h: 15, m: 13 } },
    7:  { hp: { h: 145, m: 115, l: 86 }, ac: { h: 25, m: 24, l: 23 }, atk: { h: 18, m: 17 }, dmg: { h: 21, m: 17, l: 14 }, save: { h: 15, m: 14, l: 12 }, skill: { h: 16, m: 14 } },
    8:  { hp: { h: 170, m: 135, l: 100 }, ac: { h: 27, m: 26, l: 24 }, atk: { h: 20, m: 19 }, dmg: { h: 23, m: 19, l: 15 }, save: { h: 16, m: 15, l: 13 }, skill: { h: 18, m: 16 } },
    9:  { hp: { h: 195, m: 155, l: 118 }, ac: { h: 28, m: 27, l: 26 }, atk: { h: 21, m: 20 }, dmg: { h: 26, m: 21, l: 17 }, save: { h: 18, m: 17, l: 15 }, skill: { h: 19, m: 17 } },
    10: { hp: { h: 220, m: 175, l: 130 }, ac: { h: 30, m: 29, l: 27 }, atk: { h: 23, m: 22 }, dmg: { h: 28, m: 23, l: 18 }, save: { h: 19, m: 18, l: 16 }, skill: { h: 21, m: 19 } },
    11: { hp: { h: 245, m: 195, l: 148 }, ac: { h: 31, m: 30, l: 28 }, atk: { h: 24, m: 23 }, dmg: { h: 30, m: 25, l: 20 }, save: { h: 21, m: 20, l: 18 }, skill: { h: 22, m: 20 } },
    12: { hp: { h: 270, m: 215, l: 160 }, ac: { h: 33, m: 32, l: 30 }, atk: { h: 26, m: 25 }, dmg: { h: 33, m: 27, l: 22 }, save: { h: 22, m: 21, l: 19 }, skill: { h: 24, m: 22 } },
    13: { hp: { h: 295, m: 235, l: 177 }, ac: { h: 34, m: 33, l: 31 }, atk: { h: 27, m: 26 }, dmg: { h: 35, m: 29, l: 23 }, save: { h: 23, m: 22, l: 20 }, skill: { h: 25, m: 23 } },
    14: { hp: { h: 320, m: 255, l: 190 }, ac: { h: 36, m: 35, l: 33 }, atk: { h: 29, m: 28 }, dmg: { h: 37, m: 31, l: 25 }, save: { h: 25, m: 24, l: 22 }, skill: { h: 27, m: 25 } },
    15: { hp: { h: 345, m: 275, l: 206 }, ac: { h: 37, m: 36, l: 34 }, atk: { h: 30, m: 29 }, dmg: { h: 40, m: 33, l: 26 }, save: { h: 26, m: 25, l: 23 }, skill: { h: 28, m: 26 } },
    16: { hp: { h: 370, m: 295, l: 221 }, ac: { h: 39, m: 38, l: 36 }, atk: { h: 32, m: 31 }, dmg: { h: 42, m: 35, l: 28 }, save: { h: 28, m: 27, l: 25 }, skill: { h: 30, m: 28 } },
    17: { hp: { h: 395, m: 315, l: 236 }, ac: { h: 40, m: 39, l: 37 }, atk: { h: 33, m: 32 }, dmg: { h: 45, m: 37, l: 29 }, save: { h: 29, m: 28, l: 26 }, skill: { h: 32, m: 30 } },
    18: { hp: { h: 420, m: 335, l: 250 }, ac: { h: 42, m: 41, l: 39 }, atk: { h: 35, m: 34 }, dmg: { h: 47, m: 39, l: 31 }, save: { h: 30, m: 29, l: 27 }, skill: { h: 33, m: 31 } },
    19: { hp: { h: 445, m: 355, l: 268 }, ac: { h: 43, m: 42, l: 40 }, atk: { h: 36, m: 35 }, dmg: { h: 49, m: 41, l: 33 }, save: { h: 32, m: 31, l: 29 }, skill: { h: 35, m: 33 } },
    20: { hp: { h: 470, m: 375, l: 280 }, ac: { h: 45, m: 44, l: 42 }, atk: { h: 38, m: 37 }, dmg: { h: 52, m: 43, l: 34 }, save: { h: 33, m: 32, l: 30 }, skill: { h: 36, m: 34 } },
    21: { hp: { h: 500, m: 400, l: 300 }, ac: { h: 46, m: 45, l: 44 }, atk: { h: 39, m: 38 }, dmg: { h: 54, m: 45, l: 36 } },
    22: { hp: { h: 540, m: 430, l: 322 }, ac: { h: 48, m: 47, l: 45 }, atk: { h: 41, m: 40 }, dmg: { h: 57, m: 48, l: 38 } },
    23: { hp: { h: 575, m: 460, l: 345 }, ac: { h: 49, m: 48, l: 46 }, atk: { h: 42, m: 41 }, dmg: { h: 59, m: 50, l: 40 } },
    24: { hp: { h: 633, m: 500, l: 375 }, ac: { h: 51, m: 50, l: 48 }, atk: { h: 44, m: 43 }, dmg: { h: 62, m: 52, l: 42 } }
};
const ROLES = {
    soldier: { hp: 'h', ac: 'h', atk: 'h', dmg: 'h', fort: 'h', ref: 'm', will: 'l', per: 'm' },
    brute:   { hp: 'h', ac: 'l', atk: 'h', dmg: 'h', fort: 'h', ref: 'l', will: 'm', per: 'l' },
    skirmisher: { hp: 'm', ac: 'm', atk: 'h', dmg: 'm', fort: 'm', ref: 'h', will: 'l', per: 'h' },
    caster:  { hp: 'l',  ac: 'l', atk: 'm', dmg: 'l', fort: 'l', ref: 'm', will: 'h', per: 'm' },
    boss:    { hp: 'h', ac: 'h', atk: 'h', dmg: 'h', fort: 'h', ref: 'h', will: 'h', per: 'h' }
};
const SKILL_MAP = {
    "acrobatics": "acr", "arcana": "arc", "athletics": "ath", "crafting": "cra",
    "deception": "dec", "diplomacy": "dip", "intimidation": "itm", "medicine": "med",
    "nature": "nat", "occultism": "occ", "performance": "prf", "religion": "rel",
    "society": "soc", "stealth": "ste", "survival": "sur", "thievery": "thi",
};
export async function updateNpcStats(actor, targetLevel, roleKey) {
    if (actor._isArchitectScaling) {
        ui.notifications.warn("NPC Architect: Processing update, please wait...");
        return;
    }
    actor._isArchitectScaling = true;

    const currentLevel = actor.system.details.level.value || 0;
    let blueprint = null;
    let boostedSkills = new Set(); 
    let customArchetypeDef = null;

    if (ROLES[roleKey]) {
        blueprint = { ...ROLES[roleKey], items: [] };
    } else {
        const customArchetypes = game.settings.get("pf2e-npc-architect", "customArchetypes");
        const archetype = customArchetypes[roleKey];
        customArchetypeDef = archetype; 
        if (archetype) {
            const levelData = archetype.levels.find(l => l.level === targetLevel);
            
            archetype.levels.forEach(l => {
                if (l.level <= targetLevel && l.skill) {
                    l.skill.split(',').forEach(s => {
                        const cleanName = s.trim().toLowerCase();
                        if (SKILL_MAP[cleanName]) {
                            boostedSkills.add(SKILL_MAP[cleanName]);
                        }
                    });
                }
            });

            if (levelData) {
                const mapStat = (val) => (val === "high" ? "h" : val === "mod" ? "m" : "l");
                blueprint = {
                    hp: mapStat(levelData.hp),
                    ac: mapStat(levelData.ac),
                    fort: mapStat(levelData.fort || 'm'),
                    ref: mapStat(levelData.ref || 'm'),
                    will: mapStat(levelData.will || 'm'),
                    per: mapStat(levelData.per || 'm'),
                    atk: 'h', dmg: 'h', 
                    items: levelData.items || [] 
                };
            }
        }
    }

    if (!blueprint) return ui.notifications.error("NPC Architect: No data found.");
    const matrix = LEVEL_MATRICES[targetLevel];
    if (!matrix) return ui.notifications.error("NPC Architect: Level out of bounds.");

    const updateData = {
        "system.details.level.value": parseInt(targetLevel),
        "system.attributes.hp.max": matrix.hp[blueprint.hp],
        "system.attributes.hp.value": matrix.hp[blueprint.hp],
        "system.attributes.ac.value": matrix.ac[blueprint.ac],
        "system.saves.fortitude.value": matrix.save[blueprint.fort],
        "system.saves.reflex.value": matrix.save[blueprint.ref],
        "system.saves.will.value": matrix.save[blueprint.will],
        "system.attributes.perception.value": matrix.save[blueprint.per]
    };
    await actor.update(updateData);

    const levelDiff = targetLevel - currentLevel;
    const skillUpdates = {};

    if (levelDiff !== 0) {
        for (const [key, skill] of Object.entries(actor.system.skills)) {
            const currentBase = skill.base || 0;
            if (currentBase > 0) { 
                skillUpdates[`system.skills.${key}.base`] = currentBase + levelDiff;
            }
        }
    }

    boostedSkills.forEach(skillKey => {
        skillUpdates[`system.skills.${skillKey}.base`] = matrix.skill.h;
    });

    if (Object.keys(skillUpdates).length > 0) {
        await actor.update(skillUpdates);
        if (boostedSkills.size > 0) {
            ui.notifications.info(`Skills Trained to High: ${Array.from(boostedSkills).join(", ")}`);
        }
    }

    
    const spellcastingEntries = actor.items.filter(i => i.type === "spellcastingEntry");
    if (spellcastingEntries.length > 0) {
        const targetSpellAttack = matrix.atk[blueprint.atk || 'h'];
        const targetSpellSave = matrix.save[blueprint.will || 'h'];
        
        const spellUpdates = spellcastingEntries.map(entry => ({
            _id: entry.id,
            "system.spelldc.value": targetSpellAttack,
            "system.spelldc.dc": targetSpellSave + 10
        }));
        
        await actor.updateEmbeddedDocuments("Item", spellUpdates);
    }



    const strikes = actor.items.filter(i => i.type === "melee");
    
    const targetAttackBonus = matrix.atk[blueprint.atk || 'h'];
    const targetAvgDamage = matrix.dmg[blueprint.dmg || 'h'];

    if (strikes.length > 0) {
        let currentMaxBonus = -Infinity;
        strikes.forEach(s => {
            const bonus = parseInt(s.system.bonus.value) || 0;
            if (bonus > currentMaxBonus) currentMaxBonus = bonus;
        });

        const attackShift = targetAttackBonus - currentMaxBonus;
        
        const itemUpdates = [];
        for (let strike of strikes) {
            let update = { _id: strike.id };
            const currentBonus = parseInt(strike.system.bonus.value) || 0;
            update["system.bonus.value"] = currentBonus + attackShift;

            const damageRolls = strike.system.damageRolls;
            const firstRollKey = Object.keys(damageRolls)[0];
            if (firstRollKey) {
                const currentFormula = damageRolls[firstRollKey].damage;
                const diceMatch = currentFormula.match(/(\d+)d(\d+)/);
                if (diceMatch) {
                    const dieFaces = parseInt(diceMatch[2]);
                    const avgDieResult = (dieFaces + 1) / 2;
                    let newDiceCount = Math.floor((targetAvgDamage * 0.75) / avgDieResult);
                    if (newDiceCount < 1) newDiceCount = 1;
                    let flatMod = Math.round(targetAvgDamage - (newDiceCount * avgDieResult));
                    if (flatMod < 0) flatMod = 0;
                    update[`system.damageRolls.${firstRollKey}.damage`] = `${newDiceCount}d${dieFaces} + ${flatMod}`;
                } else {
                    update[`system.damageRolls.${firstRollKey}.damage`] = `${targetAvgDamage}`;
                }
            }
            itemUpdates.push(update);
        }
        await actor.updateEmbeddedDocuments("Item", itemUpdates);
    } else {
        let flatMod = Math.round(targetAvgDamage - 3.5); 
        if (flatMod < 0) flatMod = 0;
        
        const dialogContent = `
            <style>
                .forge-dark-dialog.window-app .window-content {
                    background: #1c1b1a !important;
                    background-image: none !important;
                    color: #e0e0e0;
                    border: 1px solid #4b4a44;
                }
                .forge-dark-dialog .dialog-buttons button {
                    background: rgba(255,255,255,0.1) !important;
                    color: #e0e0e0 !important;
                    border: 1px solid #5a5954 !important;
                    text-shadow: none !important;
                    transition: all 0.2s ease;
                    cursor: pointer;
                }
                .forge-dark-dialog .dialog-buttons button:hover {
                    background: rgba(255,255,255,0.2) !important;
                    color: #fff !important;
                    box-shadow: 0 0 5px rgba(255,255,255,0.2) !important;
                }
            </style>
            <form autocomplete="off">
                <p style="color:#e0e0e0;">This NPC is unarmed. Forge a weapon using the target math <strong>(${targetAvgDamage} avg damage, +${targetAttackBonus} to hit)</strong>.</p>
                <div class="form-group">
                    <label style="color:#e0e0e0;">Weapon Name</label>
                    <input type="text" id="forge-name" value="Basic Strike" style="background: rgba(255,255,255,0.9); color: #111; border: 1px solid #4b4a44; padding: 4px; border-radius: 3px;" autofocus>
                </div>
                <div class="form-group">
                    <label style="color:#e0e0e0;">Combat Style</label>
                    <select id="forge-type" style="background: rgba(255,255,255,0.9); color: #111; border: 1px solid #4b4a44; padding: 4px; border-radius: 3px;">
                        <option value="melee">Martial: Melee</option>
                        <option value="ranged">Martial: Ranged</option>
                        <option value="arcane">Caster: Arcane</option>
                        <option value="divine">Caster: Divine</option>
                        <option value="occult">Caster: Occult</option>
                        <option value="primal">Caster: Primal</option>
                    </select>
                </div>
                <div class="form-group">
                    <label style="color:#e0e0e0;">Damage Type</label>
                    <select id="forge-dmg" style="background: rgba(255,255,255,0.9); color: #111; border: 1px solid #4b4a44; padding: 4px; border-radius: 3px;">
                        <option value="bludgeoning">Bludgeoning</option>
                        <option value="piercing">Piercing</option>
                        <option value="slashing">Slashing</option>
                        <option value="fire">Fire</option>
                        <option value="cold">Cold</option>
                        <option value="electricity">Electricity</option>
                        <option value="acid">Acid</option>
                        <option value="sonic">Sonic</option>
                        <option value="force">Force</option>
                        <option value="mental">Mental</option>
                        <option value="void">Void</option>
                        <option value="vitality">Vitality</option>
                    </select>
                </div>
                <div class="form-group">
                    <label style="color:#e0e0e0;">Base Die Size</label>
                    <select id="forge-die" style="background: rgba(255,255,255,0.9); color: #111; border: 1px solid #4b4a44; padding: 4px; border-radius: 3px;">
                        <option value="random">Randomize</option>
                        <option value="4">d4</option>
                        <option value="6">d6</option>
                        <option value="8">d8</option>
                        <option value="10">d10</option>
                        <option value="12">d12</option>
                    </select>
                </div>
                <hr style="border: 0; height: 1px; background: #5a5954; margin: 10px 0;">
                <div class="form-group">
                    <label style="color:#e0e0e0;">Common Traits</label>
                    <div style="display:flex; flex-wrap:wrap; gap:8px; font-size:0.9em; align-items:center; color:#e0e0e0;">
                        <label><input type="checkbox" class="forge-trait" value="agile"> Agile</label>
                        <label><input type="checkbox" class="forge-trait" value="finesse"> Finesse</label>
                        <label><input type="checkbox" class="forge-trait" value="reach"> Reach</label>
                        <label><input type="checkbox" class="forge-trait" value="sweep"> Sweep</label>
                        <label><input type="checkbox" class="forge-trait" value="thrown"> Thrown</label>
                        <label><input type="checkbox" class="forge-trait" value="magical"> Magical</label>
                    </div>
                </div>
                <div class="form-group">
                    <label style="color:#e0e0e0;">Extra Traits</label>
                    <input type="text" id="forge-custom-traits" placeholder="deadly-d12, range-increment-60" style="background: rgba(255,255,255,0.9); color: #111; border: 1px solid #4b4a44; padding: 4px; border-radius: 3px;">
                </div>
            </form>
        `;

        new Dialog({
            title: "Forge NPC Loadout",
            content: dialogContent,
            buttons: {
                forge: {
                    icon: '<i class="fas fa-hammer"></i>',
                    label: "Forge Loadout",
                    callback: async (html) => {
                        let wName = html.find('#forge-name').val() || "Basic Strike";
                        const wType = html.find('#forge-type').val();
                        const wDmg = html.find('#forge-dmg').val();
                        let wDie = html.find('#forge-die').val();

                        const isCaster = ["arcane", "divine", "occult", "primal"].includes(wType);

                        if (wDie === "random") {
                            const diceOptions = [4, 6, 8, 10, 12];
                            wDie = diceOptions[Math.floor(Math.random() * diceOptions.length)];
                        } else {
                            wDie = parseInt(wDie);
                        }

                        const avgDieResult = (wDie + 1) / 2;
                        let diceCount = Math.floor((targetAvgDamage * 0.75) / avgDieResult);
                        if (diceCount < 1) diceCount = 1;
                        let finalFlatMod = Math.round(targetAvgDamage - (diceCount * avgDieResult));
                        if (finalFlatMod < 0) finalFlatMod = 0;

                        const traits = [];
                        html.find('.forge-trait:checked').each((i, cb) => traits.push(cb.value));
                        if (isCaster && !traits.includes("magical")) traits.push("magical");

                        const customTraitsStr = html.find('#forge-custom-traits').val();
                        if (customTraitsStr) {
                            customTraitsStr.split(',').forEach(t => {
                                const clean = t.trim().toLowerCase().replace(/\s+/g, '-');
                                if (clean) traits.push(clean);
                            });
                        }

                        const itemsToCreate = [];
                        const defaultStrike = {
                            name: wName,
                            type: "melee", 
                            img: isCaster || wType === "ranged" ? "systems/pf2e/icons/default-icons/ranged.svg" : "systems/pf2e/icons/default-icons/melee.svg",
                            system: {
                                weaponType: { value: isCaster && wName === "Magical Blast" ? "ranged" : wType },
                                traits: { value: traits },
                                damageRolls: {
                                    "strike1": {
                                        damage: `${diceCount}d${wDie} + ${finalFlatMod}`,
                                        damageType: wDmg
                                    }
                                },
                                bonus: { value: targetAttackBonus }
                            }
                        };
                        itemsToCreate.push(defaultStrike);

                        let maxSpellLevel = 0;
                        if (isCaster) {
                            maxSpellLevel = Math.max(1, Math.min(10, Math.ceil(parseInt(targetLevel) / 2)));
                            const slotConfig = {};
                            for (let i = 1; i <= maxSpellLevel; i++) {
                                slotConfig[`slot${i}`] = { max: 3, value: 3 };
                            }

                            const targetSave = matrix.save[blueprint.will || 'h'];
                            const spellcastingEntry = {
                                name: `${wType.charAt(0).toUpperCase() + wType.slice(1)} Spells`,
                                type: "spellcastingEntry",
                                img: "systems/pf2e/icons/default-icons/spellcastingEntry.svg",
                                system: {
                                    tradition: { value: wType },
                                    prepared: { value: "spontaneous" },
                                    spelldc: { value: targetAttackBonus, dc: targetSave + 10 },
                                    slots: slotConfig
                                }
                            };
                            itemsToCreate.push(spellcastingEntry);
                        }

                        const createdItems = await actor.createEmbeddedDocuments("Item", itemsToCreate);

                        if (isCaster) {
                            const entryId = createdItems.find(i => i.type === "spellcastingEntry")?.id;
                            if (entryId) {
                                const spellLists = {
                                    arcane: {
                                        0: ["Ignition", "Shield", "Detect Magic", "Phase Bolt"],
                                        1: ["Force Barrage", "Charm", "Mystic Armor", "Grease"],
                                        2: ["Invisibility", "Resist Energy", "Sticky Fire", "Web"],
                                        3: ["Fireball", "Slow", "Haste", "Lightning Bolt"],
                                        4: ["Phantasmal Killer", "Wall of Fire", "Fire Shield", "Fly"],
                                        5: ["Cone of Cold", "Fireball", "Control Water", "Acid Storm"],
                                        6: ["Disintegrate", "Skeleton Army", "Chain Lightning", "Frost Pillar"],
                                        7: ["Vacuum", "Frigid Flurry", "Momentary Recovery", "Eclipse Burst"],
                                        8: ["Quandry", "Boil Blood", "Arctic Rift", "Whirlpool"],
                                        9: ["Foresight", "Phantasmagoria"],
                                        10: ["Cataclysm"]
                                    },
                                    divine: {
                                        0: ["Divine Lance", "Shield", "Detect Magic"],
                                        1: ["Heal", "Bless"],
                                        2: ["Dispel Magic", "Clear Mind"],
                                        3: ["Holy Light", "Heroism"],
                                        4: ["Divine Wrath", "Vital Beacon"],
                                        5: ["Sending", "Breath of Life"],
                                        6: ["Raise Dead", "Heal"],
                                        7: ["Moon Burst", "Energy Aegis"],
                                        8: ["Spirit Song", "Divine Aura"],
                                        9: ["Massacre", "Wails of the Damned"],
                                        10: ["Avatar"]
                                    },
                                    occult: {
                                        0: ["Telekinetic Projectile", "Shield", "Detect Magic"],
                                        1: ["Soothe", "Command"],
                                        2: ["Invisibility", "Paranoia"],
                                        3: ["Slow", "Vampiric Feast"],
                                        4: ["Vision of Death", "Translocate"],
                                        5: ["Synaptic Pulse", "Hallucination"],
                                        6:["Blinding Fury", "Nevermind"],
                                        7:["True Target", "Fireball"],
                                        8:["Spirit Song", "Disappearance"],
                                        9:["Phantasmagoria", "Voracious Gestalt"],
                                        10:["Freeze Time"]
                                    },
                                    primal: {
                                        0: ["Ignition", "Shield", "Detect Magic"],
                                        1: ["Heal", "Breathe Fire"],
                                        2: ["Dispel Magic", "Resist Energy"],
                                        3: ["Fireball", "Earthbind"],
                                        4: ["Wall of Fire", "Vital Beacon"],
                                        5: ["Howling Blizzard", "Control Water"],
                                        6:["Chain Lightning","Tree of Seasons"],
                                        7:["Moonburst", "Sunburst", "Fiery Body"],
                                        8:["Earthquake", "Whirlwind"],
                                        9:["Wrathful Storm", "Implosion"],
                                        10:["Nature Incarnate"]
                                    }
                                };

                                const targetList = spellLists[wType];
                                let spellsToFind = [...targetList[0]];
                                for (let i = 1; i <= maxSpellLevel; i++) {
                                    if (targetList[i]) spellsToFind.push(...targetList[i]);
                                }

                                let pack = game.packs.get("pf2e.spells-srd") || game.packs.get("sf2e.spells-srd");
                                if (!pack) {
                                    pack = game.packs.find(p => p.metadata.type === "Item" && p.collection && p.collection.includes("spell"));
                                }

                                if (!pack) {
                                    ui.notifications.error("NPC Architect: Could not locate a spell compendium.");
                                    return;
                                }

                                const index = await pack.getIndex({ fields: ["name"] });
                                const spellDocs = [];
                                let missingSpells = [];
                                
                                for (let spellName of spellsToFind) {
                                    const idxEntry = index.find(e => e.name && e.name.toLowerCase() === spellName.toLowerCase());
                                    if (idxEntry) {
                                        const spellDoc = await pack.getDocument(idxEntry._id);
                                        if (spellDoc) {
                                            const spellData = spellDoc.toObject();
                                            delete spellData._id; 
                                            if (spellData.system && spellData.system.location) {
                                                spellData.system.location.value = entryId;
                                            }
                                            spellDocs.push(spellData);
                                        }
                                    } else {
                                        missingSpells.push(spellName);
                                    }
                                }
                                
                                if (spellDocs.length > 0) {
                                    await actor.createEmbeddedDocuments("Item", spellDocs);
                                    let msg = `Populated ${spellDocs.length} spells.`;
                                    if (missingSpells.length > 0) msg += ` Missing: ${missingSpells.join(", ")}`;
                                    ui.notifications.info(msg);
                                } else {
                                    ui.notifications.warn("NPC Architect: No matching spells found in the compendium.");
                                }
                            }
                        }
                    }
                },
                cancel: {
                    icon: '<i class="fas fa-times"></i>',
                    label: "Skip"
                }
            },
            default: "forge"
        }, {
            classes: ["dialog", "forge-dark-dialog"] 
        }).render(true);
    }

    if (customArchetypeDef && customArchetypeDef.levels) {
        const itemsToFetch = [];
        customArchetypeDef.levels.forEach(l => {
            if (l.level <= targetLevel && l.items) {
                l.items.forEach(i => itemsToFetch.push({ uuid: i.uuid, rank: i.rank }));
            }
        });


        itemsToFetch.reverse();

        if (itemsToFetch.length > 0 || customArchetypeDef.isCaster) {
            let entryId = null;
  
            const itemsToCreate = [];
            const itemsToDelete = new Set(); 
            const processedItemNames = new Set(); 
            const processedSpells = new Set(); 

            if (customArchetypeDef.isCaster) {
                const wType = customArchetypeDef.tradition || "arcane";
                let maxSpellLevel = Math.max(1, Math.min(10, Math.ceil(parseInt(targetLevel) / 2)));
                const slotConfig = {};
                for (let i = 1; i <= maxSpellLevel; i++) {
                    slotConfig[`slot${i}`] = { max: 3, value: 3 };
                }
                const targetSave = matrix.save[blueprint.will || 'h'];
                const targetAttackBonus = matrix.atk['h']; 

                const existingEntry = actor.items.find(i => i.type === "spellcastingEntry" && i.system.tradition?.value === wType);

                if (existingEntry) {
                    entryId = existingEntry.id;
                    await existingEntry.update({ "system.slots": slotConfig });
                } else {
                    const spellcastingEntry = {
                        name: `${wType.charAt(0).toUpperCase() + wType.slice(1)} Spells`,
                        type: "spellcastingEntry",
                        img: "systems/pf2e/icons/default-icons/spellcastingEntry.svg",
                        system: {
                            tradition: { value: wType },
                            prepared: { value: "spontaneous" },
                            spelldc: { value: targetAttackBonus, dc: targetSave + 10 },
                            slots: slotConfig
                        }
                    };
                    const createdEntry = await actor.createEmbeddedDocuments("Item", [spellcastingEntry]);
                    entryId = createdEntry[0].id;
                }
            }

            for (let req of itemsToFetch) {
                const sourceItem = await fromUuid(req.uuid);
                if (sourceItem) {
                    let shouldInject = true;
                    
                    if (sourceItem.type === "spell") {
                        const incomingRank = req.rank ? parseInt(req.rank) : (sourceItem.system?.level?.value || 1);
                        const spellKey = `${sourceItem.name}-${incomingRank}`;
                        

                        const exactDuplicates = actor.items.filter(i => 
                            i.name === sourceItem.name && 
                            i.type === "spell" &&
                            (i.flags?.["pf2e-npc-architect"]?.injectedRank === incomingRank || 
                             (i.system?.location?.heightenedLevel || i.system?.level?.value || 1) === incomingRank)
                        );
                        
                        if (exactDuplicates.length > 0 || processedSpells.has(spellKey)) {
                            shouldInject = false; 
                        } else {
                            processedSpells.add(spellKey);
                        }
                    } else {
                        if (processedItemNames.has(sourceItem.name)) {
                            shouldInject = false;
                        } else {
                            processedItemNames.add(sourceItem.name);
                            const duplicates = actor.items.filter(i => i.name === sourceItem.name && i.type !== "spell");
                            if (duplicates.length > 0) {
                                duplicates.forEach(d => itemsToDelete.add(d.id));
                            }
                        }
                    }
                    
                    if (shouldInject) {
                        const itemData = sourceItem.toObject();
                        delete itemData._id; 
                        
                        if (itemData.type === "spell") {
                            itemData.flags = itemData.flags || {};
                            itemData.flags["pf2e-npc-architect"] = { injectedRank: req.rank ? parseInt(req.rank) : (itemData.system?.level?.value || 1) };
                            
                            if (entryId) {
                                if (!itemData.system) itemData.system = {};
                                if (!itemData.system.location) itemData.system.location = {};
                                itemData.system.location.value = entryId;
                                
                                if (req.rank) {
                                    itemData.system.location.heightenedLevel = parseInt(req.rank);
                                }
                            }
                        }
                        itemsToCreate.push(itemData);
                    }
                }
            }

            if (itemsToDelete.size > 0) {
                await actor.deleteEmbeddedDocuments("Item", Array.from(itemsToDelete));
            }

            if (itemsToCreate.length > 0) {
                await actor.createEmbeddedDocuments("Item", itemsToCreate);
                ui.notifications.info(`Injected ${itemsToCreate.length} features. Overwrote ${itemsToDelete.size} outdated abilities.`);
            }
        }
    }
    
    actor._isArchitectScaling = false;

}
export async function quickForge(actor) {
    const targetLevel = actor.system.details.level.value || 0;
    const matrix = LEVEL_MATRICES[targetLevel];
    if (!matrix) return ui.notifications.error("NPC Architect: Level out of bounds.");


    const targetAttackBonus = matrix.atk['h'];
    const targetAvgDamage = matrix.dmg['h'];
    let flatMod = Math.round(targetAvgDamage - 3.5); 
    if (flatMod < 0) flatMod = 0;

    const dialogContent = `
        <style>
            .forge-dark-dialog.window-app .window-content { background: #1c1b1a !important; background-image: none !important; color: #e0e0e0; border: 1px solid #4b4a44; }
            .forge-dark-dialog .dialog-buttons button { background: rgba(255,255,255,0.1) !important; color: #e0e0e0 !important; border: 1px solid #5a5954 !important; text-shadow: none !important; transition: all 0.2s ease; cursor: pointer; }
            .forge-dark-dialog .dialog-buttons button:hover { background: rgba(255,255,255,0.2) !important; color: #fff !important; box-shadow: 0 0 5px rgba(255,255,255,0.2) !important; }
        </style>
        <form autocomplete="off">
            <p style="color:#e0e0e0;">Forge a quick weapon using High target math for Level ${targetLevel} <strong>(${targetAvgDamage} avg damage, +${targetAttackBonus} to hit)</strong>.</p>
            <div class="form-group"><label style="color:#e0e0e0;">Weapon Name</label><input type="text" id="forge-name" value="Quick Strike" style="background: rgba(255,255,255,0.9); color: #111; border: 1px solid #4b4a44; padding: 4px; border-radius: 3px;" autofocus></div>
            <div class="form-group"><label style="color:#e0e0e0;">Combat Style</label><select id="forge-type" style="background: rgba(255,255,255,0.9); color: #111; border: 1px solid #4b4a44; padding: 4px; border-radius: 3px;"><option value="melee">Martial: Melee</option><option value="ranged">Martial: Ranged</option><option value="arcane">Caster: Arcane</option><option value="divine">Caster: Divine</option><option value="occult">Caster: Occult</option><option value="primal">Caster: Primal</option></select></div>
            <div class="form-group"><label style="color:#e0e0e0;">Damage Type</label><select id="forge-dmg" style="background: rgba(255,255,255,0.9); color: #111; border: 1px solid #4b4a44; padding: 4px; border-radius: 3px;"><option value="bludgeoning">Bludgeoning</option><option value="piercing">Piercing</option><option value="slashing">Slashing</option><option value="fire">Fire</option><option value="cold">Cold</option><option value="electricity">Electricity</option><option value="acid">Acid</option><option value="sonic">Sonic</option><option value="force">Force</option><option value="mental">Mental</option><option value="void">Void</option><option value="vitality">Vitality</option></select></div>
            <div class="form-group"><label style="color:#e0e0e0;">Base Die Size</label><select id="forge-die" style="background: rgba(255,255,255,0.9); color: #111; border: 1px solid #4b4a44; padding: 4px; border-radius: 3px;"><option value="random">Randomize</option><option value="4">d4</option><option value="6">d6</option><option value="8">d8</option><option value="10">d10</option><option value="12">d12</option></select></div>
            <hr style="border: 0; height: 1px; background: #5a5954; margin: 10px 0;">
            <div class="form-group"><label style="color:#e0e0e0;">Common Traits</label><div style="display:flex; flex-wrap:wrap; gap:8px; font-size:0.9em; align-items:center; color:#e0e0e0;"><label><input type="checkbox" class="forge-trait" value="agile"> Agile</label><label><input type="checkbox" class="forge-trait" value="finesse"> Finesse</label><label><input type="checkbox" class="forge-trait" value="reach"> Reach</label><label><input type="checkbox" class="forge-trait" value="sweep"> Sweep</label><label><input type="checkbox" class="forge-trait" value="thrown"> Thrown</label><label><input type="checkbox" class="forge-trait" value="magical"> Magical</label></div></div>
            <div class="form-group"><label style="color:#e0e0e0;">Extra Traits</label><input type="text" id="forge-custom-traits" placeholder="deadly-d12, range-increment-60" style="background: rgba(255,255,255,0.9); color: #111; border: 1px solid #4b4a44; padding: 4px; border-radius: 3px;"></div>
        </form>
    `;

    new Dialog({
        title: "Quick Forge Loadout",
        content: dialogContent,
        buttons: {
            forge: {
                icon: '<i class="fas fa-hammer"></i>',
                label: "Forge Now",
                callback: async (html) => {
                    let wName = html.find('#forge-name').val() || "Quick Strike";
                    const wType = html.find('#forge-type').val();
                    const wDmg = html.find('#forge-dmg').val();
                    let wDie = html.find('#forge-die').val();

                    const isCaster = ["arcane", "divine", "occult", "primal"].includes(wType);

                    if (wDie === "random") {
                        const diceOptions = [4, 6, 8, 10, 12];
                        wDie = diceOptions[Math.floor(Math.random() * diceOptions.length)];
                    } else {
                        wDie = parseInt(wDie);
                    }

                    const avgDieResult = (wDie + 1) / 2;
                    let diceCount = Math.floor((targetAvgDamage * 0.75) / avgDieResult);
                    if (diceCount < 1) diceCount = 1;
                    let finalFlatMod = Math.round(targetAvgDamage - (diceCount * avgDieResult));
                    if (finalFlatMod < 0) finalFlatMod = 0;

                    const traits = [];
                    html.find('.forge-trait:checked').each((i, cb) => traits.push(cb.value));
                    if (isCaster && !traits.includes("magical")) traits.push("magical");

                    const customTraitsStr = html.find('#forge-custom-traits').val();
                    if (customTraitsStr) {
                        customTraitsStr.split(',').forEach(t => {
                            const clean = t.trim().toLowerCase().replace(/\s+/g, '-');
                            if (clean) traits.push(clean);
                        });
                    }

                    const defaultStrike = {
                        name: wName,
                        type: "melee", 
                        img: isCaster || wType === "ranged" ? "systems/pf2e/icons/default-icons/ranged.svg" : "systems/pf2e/icons/default-icons/melee.svg",
                        system: {
                            weaponType: { value: isCaster && wName === "Magical Blast" ? "ranged" : wType },
                            traits: { value: traits },
                            damageRolls: { "strike1": { damage: `${diceCount}d${wDie} + ${finalFlatMod}`, damageType: wDmg } },
                            bonus: { value: targetAttackBonus }
                        }
                    };
                    
                    await actor.createEmbeddedDocuments("Item", [defaultStrike]);
                    ui.notifications.info(`NPC Architect: Forged ${wName} for ${actor.name}.`);
                }
            },
            cancel: { icon: '<i class="fas fa-times"></i>', label: "Cancel" }
        },
        default: "forge"
    }, { classes: ["dialog", "forge-dark-dialog"] }).render(true);
}