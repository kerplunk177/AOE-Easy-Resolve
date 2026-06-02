// --- V14 STRICT DATA MODELS ---
class CombatLedgerData extends foundry.abstract.DataModel {
    static defineSchema() {
        const fields = foundry.data.fields;
        return {
            actors: new fields.ObjectField({ initial: {} }),
            masterLog: new fields.ArrayField(new fields.ObjectField(), { initial: [] }),
            totalDamage: new fields.NumberField({ initial: 0, integer: true }),
            startTime: new fields.NumberField({ nullable: true, initial: null }),
            maxRounds: new fields.NumberField({ initial: 1, integer: true }),
            currentTurnStart: new fields.NumberField({ nullable: true, initial: null }),
            currentCombatant: new fields.StringField({ nullable: true, initial: null }),
            currentTurnRound: new fields.NumberField({ nullable: true, initial: null })
        };
    }
}
window.CombatLedgerData = CombatLedgerData;

window.CombatParser = {
    ledger: { actors: {}, masterLog: [], totalDamage: 0, startTime: null, maxRounds: 1, currentTurnStart: null, currentCombatant: null, currentTurnRound: null },
    explorationLedger: { actors: {}, masterLog: [], totalDamage: 0, startTime: null, maxRounds: 1 },

    getCanonicalName: function(actorDoc, alias) {
        if (!actorDoc) return alias || "Unknown";
        if (actorDoc.type === "character" || actorDoc.type === "familiar" || actorDoc.hasPlayerOwner) return actorDoc.name;
        return alias || actorDoc.name;
    },

    getMasterName: function(actorDoc, tokenAlias) {
        if (actorDoc && actorDoc.flags?.pf2e?.master?.id) {
            let master = game.actors.get(actorDoc.flags.pf2e.master.id);
            if (master) return master.name;
        }
        let checkName = tokenAlias || (actorDoc ? actorDoc.name : "");
        let match = checkName.match(/^(.+?)'s /i);
        if (match) {
            let possibleName = match[1].toLowerCase();
            let masterActor = game.actors.contents.find(a => 
                (a.type === "character" || a.hasPlayerOwner) && 
                a.id !== actorDoc?.id && 
                a.name.toLowerCase().includes(possibleName)
            );
            if (masterActor) return masterActor.name;
        }
        if (actorDoc) {
            let traits = actorDoc.system?.traits?.value || [];
            let isMinion = traits.includes("minion") || traits.includes("eidolon") || actorDoc.type === "familiar";
            if (isMinion) {
                let ownerUser = game.users.find(u => !u.isGM && actorDoc.testUserPermission(u, "OWNER"));
                if (ownerUser && ownerUser.character && ownerUser.character.id !== actorDoc.id) {
                    return ownerUser.character.name;
                }
            }
        }
        return null;
    },

    resolveOwner: function(actorName, actorDoc, tokenAlias) {
        if (!actorName) return "Unknown";
        let masterName = this.getMasterName(actorDoc, tokenAlias);
        let checkName = tokenAlias || actorName;
        
        if (masterName && checkName.toLowerCase().startsWith(masterName.toLowerCase() + "'s ")) {
            return checkName.substring(masterName.length + 3).trim();
        }
        let match = checkName.match(/^.+?'s (.+)/i);
        if (match) return match[1].trim(); 
        
        return actorName;
    },

    resetLedger: function() {
        this.ledger = { actors: {}, masterLog: [], totalDamage: 0, startTime: Date.now(), maxRounds: 1, currentTurnStart: null, currentCombatant: null, currentTurnRound: null };
        console.log("PF2e Holodeck | Tactical ledger wiped clean.");
    },

    resetExplorationLedger: function() {
        this.explorationLedger = { actors: {}, masterLog: [], totalDamage: 0, startTime: Date.now(), maxRounds: 1 };
        console.log("PF2e Holodeck | Exploration ledger wiped clean.");
    },

    seedCombatants: function(combat) {
        if (!combat || !combat.combatants) return;
        const activeLedger = this.ledger;
        
        const checkIsAlly = (actDoc) => {
            if (!actDoc) return false;
            if (actDoc.type === "character" || actDoc.type === "familiar") return true;
            if (actDoc.alliance === "party") return true;
            try { if (game.users.some(u => !u.isGM && actDoc.testUserPermission(u, "OWNER"))) return true; } catch(e){}
            return false;
        };

        combat.combatants.forEach(c => {
            let actorDoc = c.actor;
            if (!actorDoc) return;
            
            let rawName = window.CombatParser.getCanonicalName(actorDoc, c.name);
            let actorName = window.CombatParser.resolveOwner(rawName, actorDoc, c.name);
            let masterName = window.CombatParser.getMasterName(actorDoc, c.name);
            let actorType = actorDoc.type;
            let actorLevel = parseInt(actorDoc.system?.details?.level?.value) || 0;
            let allyStatus = checkIsAlly(actorDoc);

            if (!activeLedger.actors[actorName]) {
                activeLedger.actors[actorName] = {
                    name: actorName, type: actorType, level: actorLevel, isAlly: allyStatus,
                    master: masterName,
                    damageDealt: 0, healingDealt: 0, hits: 0, misses: 0, crits: 0, critMisses: 0, 
                    damageTakenTypes: {}, damageTakenSources: {}, healingReceivedSources: {}, mitigatedSources: {},
                    incomingAttacks: 0, incomingAttacksDodged: 0, incomingSaves: 0, incomingSavesResisted: 0,
                    advanced: { huntedShots: 0, huntedShotDmg: 0, taunts: 0, tauntTriggers: 0, surges: 0, surgeFriendlyDmg: 0, surgeTypes: {} },
                    expectedDamage: 0, actualDamageRoll: 0, damageTypes: {}, turnTimes: [], d20Rolls: Array(20).fill(0), history: [], nat1s: 0, nat20s: 0, kills: 0, mitigated: 0, heroPoints: 0, heroPointCrits: 0
                };
            } else {
                if (allyStatus) activeLedger.actors[actorName].isAlly = true;
            }
        });
    },

    saveArchive: async function() {
        if (!game.user.isGM || Object.keys(this.ledger.actors).length === 0) return;
        const isHolodeck = canvas.scene?.getFlag('pf2e-holodeck', 'active');
        const targetDbName = isHolodeck ? 'holodeckHistory' : 'combatHistory';
        const history = game.settings.get('pf2e-holodeck', targetDbName) || {};
        const now = new Date();
        const encounterName = `${isHolodeck ? "[SIM] " : ""}${canvas.scene?.name || "Unknown Zone"} (${now.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} - ${now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })})`;
        
        history[encounterName] = foundry.utils.deepClone(this.ledger);
        await game.settings.set('pf2e-holodeck', targetDbName, history);
        if (game.user.isGM) await game.settings.set('pf2e-holodeck', 'activeTactical', {});
        this.resetLedger();
    },

    saveExplorationArchive: async function() {
        if (!game.user.isGM || Object.keys(this.explorationLedger.actors).length === 0) return;
        const history = game.settings.get('pf2e-holodeck', 'explorationHistory') || {};
        const now = new Date();
        const encounterName = `[EXPLORE] ${canvas.scene?.name || "Unknown Zone"} (${now.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} - ${now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })})`;
        
        history[encounterName] = foundry.utils.deepClone(this.explorationLedger);
        await game.settings.set('pf2e-holodeck', 'explorationHistory', history);
        this.resetExplorationLedger();
    },

    saveLiveBackup: async function() {
        if (!game.user.isGM) return;
        await game.settings.set('pf2e-holodeck', 'activeTactical', this.ledger);
    },

    restoreLiveBackup: function() {
        let saved = game.settings.get('pf2e-holodeck', 'activeTactical');
        if (saved && saved.actors && Object.keys(saved.actors).length > 0 && game.combat && game.combat.active) {
            this.ledger = foundry.utils.deepClone(saved.toObject ? saved.toObject() : saved);
            console.log("Combat Forensics | Restored mid-session combat from backup.");
        }
    },

    parseMessage: function(message) {
        try {
            const systemFlags = message.flags?.pf2e || message.flags?.sf2e || {};
            const context = systemFlags.context || {};
            const fullText = `${message.flavor || ""} ${message.content || ""}`.replace(/<[^>]*>?/gm, ' ').trim();
            const lowerFull = fullText.toLowerCase();

            const isCombatPhase = (canvas.scene && canvas.scene.getFlag('pf2e-holodeck', 'active')) || (game.combat && game.combat.active);
            const activeLedger = isCombatPhase ? this.ledger : this.explorationLedger;

            let msgActor = message.actor || (message.speaker?.actor ? game.actors.get(message.speaker.actor) : null);
            let alias = message.speaker?.alias || message.alias;
            let rawActorName = this.getCanonicalName(msgActor, alias);
            let resolvedOwner = this.resolveOwner(rawActorName, msgActor, alias);
            let ownerMaster = this.getMasterName(msgActor, alias);

            const getActorLevel = (actorDoc) => parseInt(actorDoc?.system?.details?.level?.value) || 0;
            const checkIsAlly = (actDoc) => {
                if (!actDoc) return false;
                if (actDoc.type === "character" || actDoc.type === "familiar") return true;
                if (actDoc.alliance === "party") return true;
                try { if (game.users.some(u => !u.isGM && actDoc.testUserPermission(u, "OWNER"))) return true; } catch(e){}
                return false;
            };

            if (resolvedOwner && !activeLedger.actors[resolvedOwner]) {
                activeLedger.actors[resolvedOwner] = {
                    name: resolvedOwner, type: msgActor ? msgActor.type : "npc", level: getActorLevel(msgActor), isAlly: checkIsAlly(msgActor),
                    master: ownerMaster,
                    damageDealt: 0, healingDealt: 0, hits: 0, misses: 0, crits: 0, critMisses: 0,
                    damageTakenTypes: {}, damageTakenSources: {}, healingReceivedSources: {}, mitigatedSources: {},
                    incomingAttacks: 0, incomingAttacksDodged: 0, incomingSaves: 0, incomingSavesResisted: 0,
                    advanced: { huntedShots: 0, huntedShotDmg: 0, taunts: 0, tauntTriggers: 0, surges: 0, surgeFriendlyDmg: 0, surgeTypes: {} },
                    nat1s: 0, nat20s: 0, kills: 0, mitigated: 0, heroPoints: 0, heroPointCrits: 0, expectedDamage: 0, actualDamageRoll: 0, damageTypes: {}, turnTimes: [], d20Rolls: Array(20).fill(0), history: []
                };
            }
            let stats = activeLedger.actors[resolvedOwner];

            if (stats) {
                if (lowerFull.includes("hunted shot fused damage") || lowerFull.includes("hunted shot: fused damage")) stats.advanced.huntedShots++;
                if (lowerFull.includes("guardian's taunt")) stats.advanced.taunts++;
                if (lowerFull.includes("wellspring surge")) stats.advanced.surges++;
            }
            if (lowerFull.includes("taunt penalty triggered!")) {
                let guardian = Object.values(activeLedger.actors).find(a => a.isAlly && a.advanced && a.advanced.taunts > 0);
                if (guardian) guardian.advanced.tauntTriggers++;
            }

            const isDamageTaken = context.type === "damage-taken" || lowerFull.includes("damage taken");
            const isAttack = context.type === "attack-roll" || context.type === "spell-attack-roll";

           const coverFlags = message.flags?.["tactical-cover"];
           if (coverFlags && Array.isArray(coverFlags.obstructors)) {
               coverFlags.obstructors.forEach(obs => {
                   const obsName = typeof obs === 'string' ? obs : obs.name;
                   const isFriendlyShot = obs.isFriendlyFire ?? false;

                   // Bulletproof actor initialization
                   if (!activeLedger.actors[obsName]) {
                       activeLedger.actors[obsName] = {
                           name: obsName, type: "npc", level: 0, isAlly: false, master: null,
                           damageDealt: 0, healingDealt: 0, hits: 0, misses: 0, crits: 0, critMisses: 0,
                           damageTakenTypes: {}, damageTakenSources: {}, healingReceivedSources: {}, mitigatedSources: {},
                           incomingAttacks: 0, incomingAttacksDodged: 0, incomingSaves: 0, incomingSavesResisted: 0,
                           advanced: { huntedShots: 0, huntedShotDmg: 0, taunts: 0, tauntTriggers: 0, surges: 0, surgeFriendlyDmg: 0, surgeTypes: {}, providedCover: 0, interruptedEnemy: 0, interruptedFriendly: 0 },
                           nat1s: 0, nat20s: 0, kills: 0, mitigated: 0, heroPoints: 0, heroPointCrits: 0, expectedDamage: 0, actualDamageRoll: 0, damageTypes: {}, turnTimes: [], d20Rolls: Array(20).fill(0), history: []
                       };
                   }
                   
                   let obsStats = activeLedger.actors[obsName];
                   obsStats.advanced = obsStats.advanced || {};
                   
                   // Route the stat to the correct team
                   if (isFriendlyShot) {
                       obsStats.advanced.interruptedFriendly = (obsStats.advanced.interruptedFriendly || 0) + 1;
                   } else {
                       obsStats.advanced.interruptedEnemy = (obsStats.advanced.interruptedEnemy || 0) + 1;
                   }
                   obsStats.advanced.providedCover = (obsStats.advanced.providedCover || 0) + 1;
               });
           }
            const isSave = context.type === "saving-throw";
            const isSkill = context.type === "skill-check" || context.type === "perception-check";
            const isDamageRoll = message.isDamageRoll || context.type === "damage-roll";
            const hasAppliedDamage = !!systemFlags.appliedDamage;
            const hasAoEPayload = message.flags?.["aoe-easy-resolve"]?.damageTotal !== undefined;

       
            const isBaseCard = context.type === "spell-cast" || context.type === "action" || context.type === "spell-effect";
            if (isBaseCard && !hasAoEPayload) return;

            const isNarrative = /(?:takes|taking|applied|healed|restored|reduced by|mitigated|recovered)[^\d]*\d+/i.test(fullText) || /(?:unscathed|completely absorbing)/i.test(fullText);

            let isSynergyTextOnly = false;
            if (!isDamageTaken && !isAttack && !isSave && !isSkill && !isDamageRoll && !hasAppliedDamage && !isNarrative && !hasAoEPayload) {
                if (lowerFull.includes("guardian's taunt") || lowerFull.includes("taunt penalty triggered!") || lowerFull.includes("wellspring surge")) {
                    isSynergyTextOnly = true;
                } else return; 
            }

            let minionName = null;
            let checkNameForTag = (rawActorName !== resolvedOwner) ? rawActorName : (alias !== resolvedOwner ? alias : null);
            if (checkNameForTag) {
                let match = checkNameForTag.match(/^.+?'s (.+)/i);
                if (match) minionName = match[1].trim();
                else minionName = checkNameForTag.trim();
            } else if (msgActor && msgActor.name !== resolvedOwner) {
                minionName = msgActor.name.trim();
            }
            if (minionName === "Unknown" || minionName === "") minionName = null;

            let actionName = "Unknown Action";
            if (message.flavor) {
                let cleanFlavor = message.flavor.replace(/<\/h4>/gi, ' - ').replace(/<\/span>/gi, ' | ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').replace(/\|\s*\|/g, '|').replace(/\s*\|\s*$/g, '').trim();
                if (cleanFlavor) actionName = cleanFlavor;
            } else {
                actionName = message.item ? message.item.name : "Unknown Action";
            }

            if (isSynergyTextOnly) return;

            // --- DAMAGE APPLICATION PHASE ---
            const isApplication = !isDamageRoll && !isAttack && !isSave && !isSkill && (isDamageTaken || hasAppliedDamage || isNarrative || hasAoEPayload);

            if (isApplication) {
                const applied = systemFlags.appliedDamage;
                
                let aoeValue = null;
                let isAoEHealing = false;
                if (hasAoEPayload) {
                     isAoEHealing = /(?:healed|restored|healing|recovered)/i.test(message.flags["aoe-easy-resolve"].damageTooltip || fullText);
                     aoeValue = parseInt(message.flags["aoe-easy-resolve"].damageTotal);
                }
                
                const isHealing = applied ? applied.isHealing === true : (isAoEHealing || /(?:healed|restored|healing|recovered)/i.test(fullText));

                let attackerName = "Unknown Source";
                let attackerType = "npc";
                let attackerLevel = 0;
                let attackerDoc = null; 
                let actionNameResolved = actionName;
                let targetName = "None";
                let targetLevel = 0;
                let targetDoc = null;
                let inheritedMinion = minionName;

                if (context.target?.token) {
                    let tDoc = fromUuidSync(context.target.token);
                    if (tDoc) { targetName = tDoc.name || tDoc.parent?.name || "None"; targetDoc = tDoc.actor || tDoc; }
                } 
                if (targetName === "None" && systemFlags.appliedDamage?.uuid) {
                    targetDoc = fromUuidSync(systemFlags.appliedDamage.uuid);
                    if (targetDoc) targetName = targetDoc.parent?.name || targetDoc.name;
                } 
                if (targetName === "None" && message.speaker?.alias) {
                    targetName = message.speaker.alias;
                    targetDoc = message.actor;
                }

                let tRawName = targetName;
                if (targetDoc) {
                    tRawName = window.CombatParser.getCanonicalName(targetDoc, targetName);
                    targetName = window.CombatParser.resolveOwner(tRawName, targetDoc, targetName);
                    targetLevel = getActorLevel(targetDoc);
                }
                let actualTargetMinion = (tRawName !== targetName) ? tRawName.replace(/^.+?'s /i, '').trim() : null;

                let hasSolidOrigin = false;
                let originUuid = systemFlags.origin?.uuid || message.flags["aoe-easy-resolve"]?.origin;
                if (originUuid) {
                    let originDoc = fromUuidSync(originUuid);
                    if (originDoc) {
                        let actualActor = originDoc.actor || originDoc.parent || originDoc;
                        if (actualActor && actualActor.name) {
                            let tAlias = actualActor.name;
                            let rawName = window.CombatParser.getCanonicalName(actualActor, tAlias);
                            attackerName = window.CombatParser.resolveOwner(rawName, actualActor, tAlias);
                            attackerType = actualActor.type || "npc";
                            attackerLevel = getActorLevel(actualActor);
                            if (originDoc.type === "spell" || originDoc.type === "feat" || originDoc.type === "weapon" || originDoc.type === "action") {
                                actionNameResolved = originDoc.name;
                            }
                            hasSolidOrigin = true;
                        }
                    }
                }

               
                if (!hasSolidOrigin && (attackerName === "Unknown Source" || attackerName === targetName)) {
                    for (let i = activeLedger.masterLog.length - 1; i >= 0; i--) {
                        let prev = activeLedger.masterLog[i];
                        if (prev.type === "Roll" || prev.type === "Attack" || prev.type === "Spell") {
                            attackerName = prev.source;
                            if (prev.name && prev.name !== "Unknown Action") actionNameResolved = prev.name;
                            if (prev.minion) inheritedMinion = prev.minion;
                            attackerDoc = game.actors.find(a => a.name === attackerName);
                            break;
                        }
                    }
                }

                let valueTotal = 0;
                if (aoeValue !== null) {
                     valueTotal = aoeValue;
                } else if (applied && applied.damage !== undefined) {
                     valueTotal = parseInt(applied.damage);
                } else if (applied && applied.amount !== undefined) {
                     valueTotal = parseInt(applied.amount);
                } else {
                  
                    const textMatch = fullText.match(/(?:damaged for|healed|takes|restored|healing|applied|recovered).*?(\d+)/i) || fullText.match(/(\d+)\s*(?:HP|Damage|DMG|Heal|Healing|applied)/i);
                    if (textMatch) valueTotal = parseInt(textMatch[1]);
                    else {
                        const allNums = fullText.match(/(\d+)/g);
                        if (allNums && allNums.length > 0) valueTotal = parseInt(allNums[allNums.length - 1]);
                    }
                }
                
                if (/(?:unscathed|completely absorbing)/i.test(fullText)) valueTotal = 0;
                if (valueTotal === 0 && !/(?:unscathed|completely absorbing)/i.test(fullText)) return;

                // --- BULLETPROOF ATTACKER CREATION ---
                let aMaster = this.getMasterName(attackerDoc, attackerName);
                let aAlly = attackerName === resolvedOwner ? stats?.isAlly : false;
                if (aMaster && !aAlly) {
                    let mDoc = game.actors.find(a => a.name === aMaster);
                    if (mDoc && (mDoc.type === "character" || mDoc.hasPlayerOwner)) aAlly = true;
                }

                if (!activeLedger.actors[attackerName]) {
                    activeLedger.actors[attackerName] = {
                        name: attackerName, type: attackerType, level: attackerLevel, isAlly: aAlly,
                        master: aMaster,
                        damageDealt: 0, healingDealt: 0, hits: 0, misses: 0, crits: 0, critMisses: 0, 
                        damageTakenTypes: {}, damageTakenSources: {}, healingReceivedSources: {}, mitigatedSources: {},
                        incomingAttacks: 0, incomingAttacksDodged: 0, incomingSaves: 0, incomingSavesResisted: 0,
                        advanced: { huntedShots: 0, huntedShotDmg: 0, taunts: 0, tauntTriggers: 0, surges: 0, surgeFriendlyDmg: 0, surgeTypes: {} },
                        nat1s: 0, nat20s: 0, kills: 0, mitigated: 0, heroPoints: 0, heroPointCrits: 0, expectedDamage: 0, actualDamageRoll: 0, damageTypes: {}, turnTimes: [], d20Rolls: Array(20).fill(0), history: [] 
                    };
                }
                let aStats = activeLedger.actors[attackerName];
                if (aMaster && !aStats.master) aStats.master = aMaster;
                if (aAlly && !aStats.isAlly) aStats.isAlly = true;

                let currentRound = game.combat ? game.combat.round : 1;
                if (currentRound > activeLedger.maxRounds) activeLedger.maxRounds = currentRound;

                let mitigatedTotal = 0;
                const mitRegex = /(?:reduced by|resist|absorb|shield block|mitigat)[^\d]*(\d+)/ig;
                let mitMatch;
                while ((mitMatch = mitRegex.exec(fullText)) !== null) mitigatedTotal += parseInt(mitMatch[1]);

                // --- BULLETPROOF TARGET CREATION ---
                if (targetName !== "None") {
                    let targetMaster = this.getMasterName(targetDoc, targetName); 
                    let tAlly = targetDoc ? checkIsAlly(targetDoc) : false;
                    if (targetMaster && !tAlly) {
                        let mDoc = game.actors.find(a => a.name === targetMaster);
                        if (mDoc && (mDoc.type === "character" || mDoc.hasPlayerOwner)) tAlly = true;
                    }

                    if (!activeLedger.actors[targetName]) {
                        activeLedger.actors[targetName] = {
                            name: targetName, type: targetDoc ? targetDoc.type : "npc", level: targetLevel, isAlly: tAlly,
                            master: targetMaster,
                            damageDealt: 0, healingDealt: 0, hits: 0, misses: 0, crits: 0, critMisses: 0, 
                            damageTakenTypes: {}, damageTakenSources: {}, healingReceivedSources: {}, mitigatedSources: {},
                            incomingAttacks: 0, incomingAttacksDodged: 0, incomingSaves: 0, incomingSavesResisted: 0,
                            advanced: { huntedShots: 0, huntedShotDmg: 0, taunts: 0, tauntTriggers: 0, surges: 0, surgeFriendlyDmg: 0, surgeTypes: {} },
                            nat1s: 0, nat20s: 0, kills: 0, mitigated: 0, heroPoints: 0, heroPointCrits: 0, expectedDamage: 0, actualDamageRoll: 0, damageTypes: {}, turnTimes: [], d20Rolls: Array(20).fill(0), history: [] 
                        };
                    }
                    let tStats = activeLedger.actors[targetName];
                    if (targetMaster && !tStats.master) tStats.master = targetMaster;
                    if (tAlly && !tStats.isAlly) tStats.isAlly = true;

                    if (mitigatedTotal > 0 && !isHealing) {
                        tStats.mitigated += mitigatedTotal;
                        if (!tStats.mitigatedSources) tStats.mitigatedSources = {};
                        tStats.mitigatedSources[attackerName] = (tStats.mitigatedSources[attackerName] || 0) + mitigatedTotal;
                    }
                    
                    let cleanAction = actionNameResolved.split(/(?: - | \| )/)[0].trim().replace(/\s*\([^)]*$/, "").replace(/^(?:Damage Roll:\s*|Roll:\s*)/i, "").trim();
                    let displayAction = actualTargetMinion ? `[Hit: ${actualTargetMinion}] ${cleanAction}` : cleanAction;

                    if (valueTotal > 0 && !isHealing) {
                        let typeFound = false;
                        if (message.rolls) {
                            message.rolls.forEach(r => {
                                if (r.instances) {
                                    r.instances.forEach(i => {
                                        let dt = i.type || "untyped";
                                        tStats.damageTakenTypes[dt] = (tStats.damageTakenTypes[dt] || 0) + i.total;
                                        typeFound = true;
                                    });
                                }
                            });
                        } 
                        if (!typeFound) tStats.damageTakenTypes["applied"] = (tStats.damageTakenTypes["applied"] || 0) + valueTotal;

                        if (!tStats.damageTakenSources[attackerName]) tStats.damageTakenSources[attackerName] = {};
                        tStats.damageTakenSources[attackerName][displayAction] = (tStats.damageTakenSources[attackerName][displayAction] || 0) + valueTotal;
                    }
                    else if (valueTotal > 0 && isHealing) {
                        if (!tStats.healingReceivedSources[attackerName]) tStats.healingReceivedSources[attackerName] = {};
                        tStats.healingReceivedSources[attackerName][displayAction] = (tStats.healingReceivedSources[attackerName][displayAction] || 0) + valueTotal;
                    }
                }

                if (valueTotal === 0 && mitigatedTotal === 0) return; 

                let isKill = false;
                if (applied && applied.updates) {
                    applied.updates.forEach(u => { if (u.path && u.path.includes("hp.value") && parseInt(u.value) <= 0) isKill = true; });
                }
                if (/(?:unconscious|dying|dead|destroyed|kill)/i.test(fullText)) isKill = true;

                if (isHealing) {
                    aStats.healingDealt += valueTotal;
                    const logEntry = { id: foundry.utils.randomID(), round: currentRound, source: attackerName, target: targetName, type: "Heal", name: actionNameResolved, result: `${valueTotal} HEALED`, detail: `Actual HP restored via healing.`, damageVal: 0, healVal: valueTotal, minion: inheritedMinion };
                    aStats.history.push(logEntry);
                    activeLedger.masterLog.push(logEntry);
                } else {
                    aStats.damageDealt += valueTotal;
                    if (isKill) aStats.kills++;
                    activeLedger.totalDamage += valueTotal;

                    if (lowerFull.includes("hunted shot fused damage") || lowerFull.includes("hunted shot: fused damage")) {
                        aStats.advanced.huntedShotDmg += valueTotal;
                    }
                    if (lowerFull.includes("wellspring surge")) {
                        let isTargetAlly = activeLedger.actors[targetName]?.isAlly;
                        if (aStats.isAlly && isTargetAlly) {
                            aStats.advanced.surgeFriendlyDmg += valueTotal;
                        }
                    }
                    
                    let resultText = valueTotal === 0 ? `FULLY MITIGATED` : `${valueTotal} DMG APPLIED`;
                    if (isKill) resultText += " 💀";
                    if (mitigatedTotal > 0) resultText += ` <span style="color:#aaa;">(${mitigatedTotal} BLKD)</span>`;
                    
                    const logEntry = { id: foundry.utils.randomID(), round: currentRound, source: attackerName, target: targetName, type: valueTotal === 0 ? "Mitigation" : "Damage", name: actionNameResolved, result: resultText, detail: `Actual HP removed after saves, weaknesses, and resistances.`, damageVal: valueTotal, healVal: 0, minion: inheritedMinion };
                    aStats.history.push(logEntry);
                    activeLedger.masterLog.push(logEntry);
                }
                
                if (isCombatPhase) this.saveLiveBackup();
                return; 
            }

            // --- ROLL PHASE ---
            if (isDamageRoll && message.rolls && !isAttack && !isSave && !isSkill) {
                const rollTotal = message.rolls.reduce((sum, roll) => sum + roll.total, 0);
                let damageDetails = [];
                let expectedTotal = 0;
                const actorName = resolvedOwner;
                
                let stats = activeLedger.actors[actorName];
                let currentRound = game.combat ? game.combat.round : 1;

                try {
                    const extractPF2eDice = (obj) => {
                        let actual = 0; let expected = 0; let seen = new Set();
                        const search = (o) => {
                            if (!o || typeof o !== 'object') return;
                            if (seen.has(o)) return;
                            seen.add(o);
                            if (o.faces !== undefined && o.number !== undefined && Array.isArray(o.results)) {
                                let activeResults = o.results.filter(res => res.active !== false && !res.discarded);
                                expected += ((o.faces + 1) / 2) * activeResults.length;
                                activeResults.forEach(res => actual += (res.result || 0));
                                return; 
                            }
                            for (let key in o) { if (o.hasOwnProperty(key)) search(o[key]); }
                        };
                        search(obj);
                        return { actual, expected };
                    };

                    message.rolls.forEach(r => {
                        let diceStats = extractPF2eDice(r);
                        expectedTotal += (r.total - diceStats.actual + diceStats.expected);
                        if (r.instances) {
                            r.instances.forEach(i => {
                                let dmgType = i.type || "untyped";
                                if (!stats.damageTypes) stats.damageTypes = {};
                                if (!stats.damageTypes[dmgType]) stats.damageTypes[dmgType] = { instances: 0, total: 0 };
                                stats.damageTypes[dmgType].instances += 1;
                                stats.damageTypes[dmgType].total += i.total;
                                damageDetails.push(`${i.total} ${dmgType}`);
                            });
                        }
                    });
                } catch (e) {
                    expectedTotal += rollTotal;
                }

                stats.expectedDamage = (stats.expectedDamage || 0) + expectedTotal;
                stats.actualDamageRoll = (stats.actualDamageRoll || 0) + rollTotal;
                let detailStr = damageDetails.length > 0 ? damageDetails.join(', ') : `Rolled ${message.rolls.length} dice`;
                let merged = false;
                
                if (stats) {
                    for (let i = stats.history.length - 1; i >= 0; i--) {
                        let prev = stats.history[i];
                        if (prev.type === "Attack" && prev.round === currentRound && !prev.hasDamageRoll) {
                            prev.result += ` 🎲 [${rollTotal}]`;
                            prev.detail += `<br><span style="color:#aaa;"><b>Dice Pool:</b> ${detailStr}</span>`;
                            prev.hasDamageRoll = true;
                            merged = true;
                            break;
                        }
                    }
                }

                if (!merged) {
                    const logEntry = { id: foundry.utils.randomID(), round: currentRound, source: actorName, target: "None", type: "Roll", name: actionName, result: `Dice Pool: ${rollTotal}`, detail: detailStr, damageVal: 0, healVal: 0, minion: minionName };
                    if (stats) stats.history.push(logEntry);
                    activeLedger.masterLog.push(logEntry);
                }
                
                if (isCombatPhase) this.saveLiveBackup();
                return;
            }

            // --- ATTACK & SAVE PHASE ---
            if (isAttack || isSave || isSkill) {
                if (!msgActor) return;

                const actorName = resolvedOwner;
                let stats = activeLedger.actors[actorName];
                let currentRound = game.combat ? game.combat.round : 1;
                if (currentRound > activeLedger.maxRounds) activeLedger.maxRounds = currentRound;

                let targetName = "None";
                let targetDoc = null;

                if (context.target?.token) {
                    let tDoc = fromUuidSync(context.target.token);
                    if (tDoc) {
                        targetName = tDoc.name || tDoc.parent?.name || "None";
                        targetDoc = tDoc.actor || tDoc;
                    }
                }
                
                if (targetName === "None" && game.user.targets.size > 0) {
                    let t = Array.from(game.user.targets)[0];
                    if (t) {
                        targetName = t.name;
                        targetDoc = t.actor;
                    }
                }

                if (targetName === "None") {
                    let match = fullText.match(/target:\s*([^|]+)/i) || (message.flavor && message.flavor.match(/target:\s*([^|]+)/i));
                    if (match) {
                        targetName = match[1].replace(/<[^>]*>?/gm, '').trim();
                        targetDoc = game.actors.find(a => a.name === targetName) || null;
                    }
                }

                if (targetDoc) {
                    let tRaw = window.CombatParser.getCanonicalName(targetDoc, targetName);
                    targetName = window.CombatParser.resolveOwner(tRaw, targetDoc, targetName);
                }

                const outcome = context.outcome;
                const outcomeStr = (outcome || "").toLowerCase();
                const isCrit = outcomeStr.includes('criticalsuccess') || outcomeStr.includes('critical-success');
                const isSucc = outcomeStr === 'success' || (outcomeStr.includes("success") && !isCrit);
                const isCritFail = outcomeStr.includes('criticalfailure') || outcomeStr.includes('critical-failure');
                const isFail = outcomeStr === 'failure' || (outcomeStr.includes("failure") && !isCritFail);
                
                if (isSucc) stats.hits++;
                if (isCrit) stats.crits++;
                if (isFail) stats.misses++;
                if (isCritFail) stats.critMisses++;

   
                // RESTORED: Target tracking for incoming attacks
                if (isAttack && targetName !== "None") {
                    let targetMaster = this.getMasterName(targetDoc, targetName);
                    let tAlly = targetDoc ? checkIsAlly(targetDoc) : false;
                    let targetLevel = targetDoc ? getActorLevel(targetDoc) : 0; // <--- THE FIX

                    if (!activeLedger.actors[targetName]) {
                        activeLedger.actors[targetName] = {
                            name: targetName, type: targetDoc ? targetDoc.type : "npc", level: targetLevel, isAlly: tAlly, master: targetMaster,
                            damageDealt: 0, healingDealt: 0, hits: 0, misses: 0, crits: 0, critMisses: 0, 
                            damageTakenTypes: {}, damageTakenSources: {}, healingReceivedSources: {}, mitigatedSources: {},
                            incomingAttacks: 0, incomingAttacksDodged: 0, incomingSaves: 0, incomingSavesResisted: 0,
                            advanced: { huntedShots: 0, huntedShotDmg: 0, taunts: 0, tauntTriggers: 0, surges: 0, surgeFriendlyDmg: 0, surgeTypes: {} },
                            nat1s: 0, nat20s: 0, kills: 0, mitigated: 0, heroPoints: 0, heroPointCrits: 0, expectedDamage: 0, actualDamageRoll: 0, damageTypes: {}, turnTimes: [], d20Rolls: Array(20).fill(0), history: []
                        };
                    }
                    let tStats = activeLedger.actors[targetName];
                    if (targetMaster && !tStats.master) tStats.master = targetMaster;
                    
                    tStats.incomingAttacks = (tStats.incomingAttacks || 0) + 1;
                    if (isFail || isCritFail) {
                        tStats.incomingAttacksDodged = (tStats.incomingAttacksDodged || 0) + 1;
                    }
                }

                if (isSave) {
                    stats.incomingSaves = (stats.incomingSaves || 0) + 1;
                    if (isSucc || isCrit) {
                        stats.incomingSavesResisted = (stats.incomingSavesResisted || 0) + 1;
                    }
                }

                const isHeroPoint = context.isReroll || (context.options && context.options.includes("hero-point")) || /(?:hero point|reroll)/i.test(fullText);
                if (isHeroPoint) {
                    stats.heroPoints++;
                    if (isCrit) stats.heroPointCrits++;
                }

                let d20Val = 0; let totalVal = 0; let modVal = 0;
                if (message.rolls && message.rolls.length > 0) {
                    const firstRoll = message.rolls[0];
                    totalVal = firstRoll.total;
                    const d20Term = firstRoll.terms ? firstRoll.terms.find(t => t.faces === 20) : null;
                    if (d20Term && d20Term.results && d20Term.results.length > 0) {
                        d20Val = d20Term.results[0].result;
                        modVal = totalVal - d20Val; 
                        if (d20Val === 1) stats.nat1s++;
                        if (d20Val === 20) stats.nat20s++;
                        if (d20Val >= 1 && d20Val <= 20) {
                            if (!stats.d20Rolls) stats.d20Rolls = Array(20).fill(0);
                            stats.d20Rolls[d20Val - 1]++;
                        }
                    }
                }

                let rollType = "Roll";
                if (isAttack) rollType = "Attack";
                if (isSave) rollType = "Save";
                if (isSkill) rollType = "Skill";

                let resultText = "UNKNOWN";
                if (outcome) resultText = outcome.toUpperCase();
                else if (totalVal > 0) resultText = `ROLLED ${totalVal}`;

                let extraDetails = [];
                let robustTags = [];
                
                if (context.traits && Array.isArray(context.traits)) {
                    context.traits.forEach(t => {
                        let tName = typeof t === 'string' ? t : t.name;
                        if (tName) robustTags.push(tName);
                    });
                }
                
                if (context.dc && context.dc.value) {
                    extraDetails.push(`<span style="color:#ffcc00; font-weight:bold;">Target DC: ${context.dc.value}</span>`);
                }
                
                if (systemFlags.modifiers && systemFlags.modifiers.length > 0) {
                    let activeMods = systemFlags.modifiers.filter(m => m.enabled || m.ignored === false).map(m => `${m.label} ${m.modifier < 0 ? '' : '+'}${m.modifier}`);
                    if (activeMods.length > 0) extraDetails.push(`<span style="color:#aaa;"><b>Mods:</b> ${activeMods.join(', ')}</span>`);
                }

                let detailHtml = `<b>Total:</b> ${totalVal} (d20: ${d20Val} + ${modVal})`;
                if (extraDetails.length > 0) {
                    detailHtml += `<br><div style="margin-top:6px; padding-top:6px; border-top:1px dashed #444; font-size:0.85em; line-height:1.4;">${extraDetails.join('<br>')}</div>`;
                }

                const logEntry = {
                    id: foundry.utils.randomID(), round: currentRound, source: actorName, target: targetName,
                    type: rollType, name: actionName, result: resultText,
                    detail: detailHtml, damageVal: 0, healVal: 0, tags: robustTags, minion: minionName
                };
                stats.history.push(logEntry);
                activeLedger.masterLog.push(logEntry);
                
                if (isCombatPhase) this.saveLiveBackup();
            }
        } catch (e) {
            console.error("Combat Forensics Parser Error:", e);
        }
    }
};

class CombatForensicsApp extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
    static DEFAULT_OPTIONS = {
        id: "combat-forensics-ui", 
        classes: ["forensics-window"], 
        position: { width: 950, height: 850 }, 
        window: { title: "Combat Forensics", resizable: true },
        actions: {
            setViewMode: async function(event, target) {
                this.viewMode = target.dataset.mode;
                this.render({ force: true });
            },
            clearHistory: async function() {
                if (game.user.isGM) {
                    await game.settings.set('pf2e-holodeck', 'combatHistory', {});
                    await game.settings.set('pf2e-holodeck', 'holodeckHistory', {});
                    await game.settings.set('pf2e-holodeck', 'explorationHistory', {});
                    this.selectedEncounter = "exploration";
                    this.expandedLogs = {};
                    this.expandedActors = {};
                    this.render({ force: true });
                    ui.notifications.warn("Combat Forensics | All databases purged.");
                }
            },
            swapAllegiance: async function(event, target) {
                const requiredRole = game.settings.get('pf2e-holodeck', 'auditPermission') || 4;
                if (game.user.role < requiredRole) return;
                
                const actorName = target.dataset.actor;
                let targetLedger = this.selectedEncounter === "current" ? window.CombatParser.ledger :
                                   this.selectedEncounter === "exploration" ? window.CombatParser.explorationLedger : null;
                let dbName = null;
                let encName = this.selectedEncounter;

                if (!targetLedger) {
                    const hDb = game.settings.get('pf2e-holodeck', 'combatHistory') || {};
                    const eDb = game.settings.get('pf2e-holodeck', 'explorationHistory') || {};
                    const sDb = game.settings.get('pf2e-holodeck', 'holodeckHistory') || {};
                    if (hDb[encName]) { targetLedger = hDb[encName]; dbName = 'combatHistory'; }
                    else if (eDb[encName]) { targetLedger = eDb[encName]; dbName = 'explorationHistory'; }
                    else if (sDb[encName]) { targetLedger = sDb[encName]; dbName = 'holodeckHistory'; }
                }

                if (targetLedger && targetLedger.actors[actorName]) {
                    targetLedger.actors[actorName].isAlly = !targetLedger.actors[actorName].isAlly;
                    if (dbName) {
                        let db = game.settings.get('pf2e-holodeck', dbName);
                        db[encName] = targetLedger;
                        await game.settings.set('pf2e-holodeck', dbName, db);
                    }
                    this.expandedActors[actorName] = true;
                    this.render({ force: true });
                    ui.notifications.info(`Combat Forensics | ${actorName} allegiance swapped.`);
                }
            },
            createManualLog: async function(event, target) {
                event.preventDefault();
                event.stopPropagation();

                const requiredRole = game.settings.get('pf2e-holodeck', 'auditPermission') || 4;
                if (game.user.role < requiredRole) return;

                let encName = this.selectedEncounter;
                if (!encName || encName.startsWith("meta")) {
                    return ui.notifications.warn("Combat Forensics | Cannot add logs to a Meta aggregate. Select a specific encounter.");
                }

                // Acquire the correct ledger
                let targetLedger = this.selectedEncounter === "current" ? window.CombatParser.ledger :
                                   this.selectedEncounter === "exploration" ? window.CombatParser.explorationLedger : null;
                let dbName = null;

                if (!targetLedger) {
                    const hDb = game.settings.get('pf2e-holodeck', 'combatHistory') || {};
                    const eDb = game.settings.get('pf2e-holodeck', 'explorationHistory') || {};
                    const sDb = game.settings.get('pf2e-holodeck', 'holodeckHistory') || {};
                    if (hDb[encName]) { targetLedger = hDb[encName]; dbName = 'combatHistory'; }
                    else if (eDb[encName]) { targetLedger = eDb[encName]; dbName = 'explorationHistory'; }
                    else if (sDb[encName]) { targetLedger = sDb[encName]; dbName = 'holodeckHistory'; }
                }

                if (!targetLedger) return ui.notifications.error("Combat Forensics | Could not locate ledger data.");

                // Build dynamic dropdowns based on who is currently in the encounter
                let actorOptions = `<option value="Environment">Environment</option><option value="Unknown">Unknown</option>`;
                let targetOptions = `<option value="None">None</option>`;
                Object.keys(targetLedger.actors).sort().forEach(a => {
                    actorOptions += `<option value="${a}">${a}</option>`;
                    targetOptions += `<option value="${a}">${a}</option>`;
                });

                const maxRound = targetLedger.maxRounds || 1;

                const content = `
                    <style>
                        .manual-log-form { display: grid; gap: 8px; margin-bottom: 10px; }
                        .manual-log-form label { font-weight: bold; font-size: 0.9em; color: #ccc; }
                        .manual-log-form input, .manual-log-form select { width: 100%; padding: 6px; background: rgba(0,0,0,0.5); border: 1px solid #444; color: #fff; border-radius: 3px; font-family: inherit; }
                    </style>
                    <div class="manual-log-form">
                        <div><label>Round</label><input type="number" id="ml-round" value="${maxRound}" min="1"></div>
                        <div><label>Source / Attacker</label><select id="ml-source">${actorOptions}</select></div>
                        <div><label>Target</label><select id="ml-target">${targetOptions}</select></div>
                        <div><label>Action Name</label><input type="text" id="ml-name" value="Manual Adjustment" placeholder="e.g., GM Fiat, Potion, Fall Damage"></div>
                        <div><label>Log Type</label>
                            <select id="ml-type">
                                <option value="Damage">Damage</option>
                                <option value="Heal">Healing</option>
                                <option value="Misc">Miscellaneous / Note</option>
                            </select>
                        </div>
                        <div><label>Value (HP Amount)</label><input type="number" id="ml-value" value="0" min="0"></div>
                        <div><label>Result / Display Text</label><input type="text" id="ml-result" value="Applied manually." placeholder="e.g., 15 DMG, 10 HEAL"></div>
                    </div>
                    <p style="font-size: 0.8em; color: #888; font-style: italic;">Note: This will permanently add the entry to the timeline and adjust total Damage/Healing stats for the selected actors.</p>
                `;

                const confirm = await foundry.applications.api.DialogV2.prompt({
                    window: { title: "Inject Manual Log Entry" },
                    content: content,
                    ok: {
                        label: "Inject Entry",
                        icon: "fas fa-syringe",
                        callback: () => {
                            return {
                                round: parseInt(document.getElementById('ml-round').value) || 1,
                                source: document.getElementById('ml-source').value,
                                target: document.getElementById('ml-target').value,
                                name: document.getElementById('ml-name').value || "Manual Adjustment",
                                type: document.getElementById('ml-type').value,
                                value: parseInt(document.getElementById('ml-value').value) || 0,
                                result: document.getElementById('ml-result').value || "Manual Entry"
                            };
                        }
                    },
                    rejectClose: false
                });

                if (!confirm) return;

                const newLog = {
                    id: foundry.utils.randomID(),
                    round: confirm.round,
                    source: confirm.source,
                    target: confirm.target,
                    name: confirm.name,
                    type: confirm.type,
                    result: confirm.result,
                    damageVal: confirm.type === "Damage" ? confirm.value : 0,
                    healVal: confirm.type === "Heal" ? confirm.value : 0,
                    isTurnSummary: false,
                    isDivider: false,
                    detail: "Manually entered by auditor.",
                    tags: ["Manual"]
                };

                targetLedger.masterLog = Array.isArray(targetLedger.masterLog) ? targetLedger.masterLog : Object.values(targetLedger.masterLog);
                targetLedger.masterLog.push(newLog);
                
                if (confirm.round > (targetLedger.maxRounds || 1)) targetLedger.maxRounds = confirm.round;

                // Safely ensure the actors exist in case they somehow got deleted
                const initActor = (aName) => {
                    if (!aName || aName === "None" || aName === "Environment" || aName === "Unknown") return;
                    if (!targetLedger.actors[aName]) {
                        targetLedger.actors[aName] = {
                            name: aName, type: "npc", level: 0, isAlly: false, master: null,
                            damageDealt: 0, healingDealt: 0, hits: 0, misses: 0, crits: 0, critMisses: 0,
                            damageTakenTypes: {}, damageTakenSources: {}, healingReceivedSources: {}, mitigatedSources: {},
                            incomingAttacks: 0, incomingAttacksDodged: 0, incomingSaves: 0, incomingSavesResisted: 0,
                            advanced: { huntedShots: 0, huntedShotDmg: 0, taunts: 0, tauntTriggers: 0, surges: 0, surgeFriendlyDmg: 0, surgeTypes: {}, providedCover: 0, interruptedEnemy: 0, interruptedFriendly: 0 },
                            nat1s: 0, nat20s: 0, kills: 0, mitigated: 0, heroPoints: 0, heroPointCrits: 0, expectedDamage: 0, actualDamageRoll: 0, damageTypes: {}, turnTimes: [], d20Rolls: Array(20).fill(0), history: []
                        };
                    }
                };

                initActor(confirm.source);
                initActor(confirm.target);

                // Wire up Source Stats
                if (confirm.source !== "Environment" && confirm.source !== "Unknown") {
                    let sStats = targetLedger.actors[confirm.source];
                    if (confirm.type === "Damage") sStats.damageDealt += confirm.value;
                    else if (confirm.type === "Heal") sStats.healingDealt += confirm.value;
                    
                    sStats.history = Array.isArray(sStats.history) ? sStats.history : Object.values(sStats.history || {});
                    sStats.history.push(newLog);
                }

                // Wire up Target Threat Profile Stats
                if (confirm.target !== "None") {
                    let tStats = targetLedger.actors[confirm.target];
                    let cleanAction = confirm.name;
                    
                    if (confirm.type === "Damage") {
                        tStats.damageTakenSources = tStats.damageTakenSources || {};
                        tStats.damageTakenSources[confirm.source] = tStats.damageTakenSources[confirm.source] || {};
                        tStats.damageTakenSources[confirm.source][cleanAction] = (tStats.damageTakenSources[confirm.source][cleanAction] || 0) + confirm.value;
                    } else if (confirm.type === "Heal") {
                        tStats.healingReceivedSources = tStats.healingReceivedSources || {};
                        tStats.healingReceivedSources[confirm.source] = tStats.healingReceivedSources[confirm.source] || {};
                        tStats.healingReceivedSources[confirm.source][cleanAction] = (tStats.healingReceivedSources[confirm.source][cleanAction] || 0) + confirm.value;
                    }
                }

                // Append to Global Damage Total
                if (confirm.type === "Damage") {
                    targetLedger.totalDamage = (targetLedger.totalDamage || 0) + confirm.value;
                }

                // Force Raw Database Overwrite
                const flatLedger = JSON.parse(JSON.stringify(targetLedger));

                if (dbName) {
                    let fullDb = game.settings.get('pf2e-holodeck', dbName) || {};
                    let newDb = JSON.parse(JSON.stringify(fullDb));
                    newDb[encName] = flatLedger;
                    await game.settings.set('pf2e-holodeck', dbName, {}); 
                    await game.settings.set('pf2e-holodeck', dbName, newDb);
                } else if (encName === "current") {
                    window.CombatParser.ledger = flatLedger;
                    await game.settings.set('pf2e-holodeck', 'activeTactical', {});
                    await game.settings.set('pf2e-holodeck', 'activeTactical', flatLedger);
                } else if (encName === "exploration") {
                    window.CombatParser.explorationLedger = flatLedger;
                }

                ui.notifications.info("Combat Forensics | Manual log entry injected.");
                this.render(true);
            },
            deleteEncounter: async function() {
                const requiredRole = game.settings.get('pf2e-holodeck', 'auditPermission') || 4;
                if (game.user.role < requiredRole) return;

                let encName = this.selectedEncounter;
                if (encName === "current" || encName === "exploration" || encName.startsWith("meta")) {
                    return ui.notifications.warn("Combat Forensics | You can only delete saved historical encounters.");
                }

                const confirm = await foundry.applications.api.DialogV2.confirm({
                    window: { title: "Delete Encounter" },
                    content: `<p>Are you sure you want to permanently delete the encounter <b>${encName}</b>?</p>`,
                    rejectClose: false
                });

                if (!confirm) return;

                const hDb = game.settings.get('pf2e-holodeck', 'combatHistory') || {};
                const eDb = game.settings.get('pf2e-holodeck', 'explorationHistory') || {};
                const sDb = game.settings.get('pf2e-holodeck', 'holodeckHistory') || {};

                if (hDb[encName]) {
                    let newDb = JSON.parse(JSON.stringify(hDb));
                    delete newDb[encName];
                    await game.settings.set('pf2e-holodeck', 'combatHistory', newDb);
                } else if (eDb[encName]) {
                    let newDb = JSON.parse(JSON.stringify(eDb));
                    delete newDb[encName];
                    await game.settings.set('pf2e-holodeck', 'explorationHistory', newDb);
                } else if (sDb[encName]) {
                    let newDb = JSON.parse(JSON.stringify(sDb));
                    delete newDb[encName];
                    await game.settings.set('pf2e-holodeck', 'holodeckHistory', newDb);
                }

                this.selectedEncounter = "exploration";
                ui.notifications.info(`Combat Forensics | Encounter deleted.`);
                this.render(true);
            },
            reassignLog: async function(event, target) {
                const requiredRole = game.settings.get('pf2e-holodeck', 'auditPermission') || 4;
                if (game.user.role < requiredRole) return;
                
                const logId = target.dataset.logId;
                
                let targetLedger = this.selectedEncounter === "current" ? window.CombatParser.ledger :
                                   this.selectedEncounter === "exploration" ? window.CombatParser.explorationLedger : null;
                let dbName = null;
                let encName = this.selectedEncounter;

                if (!targetLedger) {
                    const hDb = game.settings.get('pf2e-holodeck', 'combatHistory') || {};
                    const eDb = game.settings.get('pf2e-holodeck', 'explorationHistory') || {};
                    const sDb = game.settings.get('pf2e-holodeck', 'holodeckHistory') || {};
                    if (hDb[encName]) { targetLedger = hDb[encName]; dbName = 'combatHistory'; }
                    else if (eDb[encName]) { targetLedger = eDb[encName]; dbName = 'explorationHistory'; }
                    else if (sDb[encName]) { targetLedger = sDb[encName]; dbName = 'holodeckHistory'; }
                }

                if (!targetLedger) return;

                const logEntry = targetLedger.masterLog.find(l => l.id === logId);
                if (!logEntry) return ui.notifications.warn("Combat Forensics | Log ID not found. Ensure databases are migrated.");

                let currentLogCoreName = logEntry.name ? logEntry.name.split(/(?: - | \| )/)[0].trim() : "Unknown Action";

                let actorAbilities = {};
                Object.entries(targetLedger.actors).forEach(([aName, aData]) => {
                    let abilities = new Set();
                    aData.history.forEach(h => {
                        if (h.name && h.name !== "Unknown Action" && h.name !== "Persistent Condition" && h.name !== "Fast Healing / Regen") {
                            let cleanName = h.name.split(/(?: - | \| )/)[0].trim();
                            abilities.add(cleanName);
                        }
                    });
                    actorAbilities[aName] = Array.from(abilities).sort();
                });

                let actorOptions = Object.keys(targetLedger.actors).map(name => `<option value="${name}" ${name === logEntry.source ? 'selected' : ''}>${name}</option>`).join("");

                let otherLogsBySource = targetLedger.masterLog.filter(l => !l.isDivider && !l.isTurnSummary && l.source === logEntry.source && l.id !== logId && l.name === logEntry.name);
                let checklistHtml = "";
                
                if (otherLogsBySource.length > 0) {
                    checklistHtml = `
                        <div style="margin-top: 15px; padding-top: 10px; border-top: 1px dashed #555;">
                            <label style="display: flex; align-items: center; gap: 8px; font-weight: bold; color: #ff4444; cursor: pointer; margin-bottom: 8px; font-size: 1.1em;">
                                <input type="checkbox" id="mass-audit-master" style="width: 16px; height: 16px;"> 
                                Attribute More (Select additional logs to move)
                            </label>
                            <div style="max-height: 200px; overflow-y: auto; background: #050508; border: 1px solid #333; padding: 10px; border-radius: 3px; box-shadow: inset 0 0 5px #000;">
                                ${otherLogsBySource.map(l => `
                                    <label style="display: flex; align-items: flex-start; gap: 8px; font-size: 0.9em; margin-bottom: 8px; color: #ccc; cursor: pointer; padding-bottom: 6px; border-bottom: 1px solid #222;">
                                        <input type="checkbox" class="mass-audit-cb" value="${l.id}" style="margin-top: 3px; width: 14px; height: 14px;">
                                        <div style="flex: 1;">
                                            <span style="color: #888; font-weight:bold;">R${l.round}</span> | 
                                            <span style="color: #ffaa00;">${l.target !== "None" ? l.target : "AoE"}</span> | 
                                            ${l.name} <br>
                                            <span style="color: ${l.type === 'Damage' ? '#ff6666' : (l.type === 'Heal' ? '#44ff44' : '#888')}; font-size: 0.9em;">
                                                ${l.type === 'Damage' ? (l.damageVal + ' DMG') : (l.type === 'Heal' ? (l.healVal + ' HEAL') : l.result)}
                                            </span>
                                        </div>
                                    </label>
                                `).join("")}
                            </div>
                        </div>
                    `;
                }

                const content = `
                    <div style="background: #0f0f15; color: #eee; padding: 15px; border: 1px solid #444; border-radius: 4px; font-family: 'Signika', sans-serif;">
                        <form>
                            <div class="form-group" style="margin-bottom: 10px;">
                                <label style="font-weight: bold; color: #ffaa00; display:block; margin-bottom:4px;">Attributing Actor:</label>
                                <select id="new-actor-source" style="width: 100%; padding: 6px; background: #222; color: #eee; border: 1px solid #555; border-radius: 3px;">
                                    ${actorOptions}
                                </select>
                            </div>
                            <div class="form-group" style="margin-bottom: 10px;">
                                <label style="font-weight: bold; color: #ffaa00; display:block; margin-bottom:4px;">Ability / Spell Source:</label>
                                <select id="new-action-select" style="width: 100%; padding: 6px; background: #222; color: #eee; border: 1px solid #555; border-radius: 3px;">
                                </select>
                            </div>
                            <div class="form-group" id="new-action-custom-container" style="margin-bottom: 10px; display: none;">
                                <label style="font-weight: bold; color: #ffaa00; display:block; margin-bottom:4px;">Custom Action Name:</label>
                                <input type="text" id="new-action-custom" value="${logEntry.name || 'Unknown Action'}" style="width: 100%; padding: 6px; background: #222; color: #eee; border: 1px solid #555; border-radius: 3px;">
                            </div>
                            ${checklistHtml}
                        </form>
                    </div>
                `;

                const dialog = new foundry.applications.api.DialogV2({
                    window: { title: "Audit Combat Record" },
                    position: { width: 500 },
                    classes: ["combat-forensics-dialog"],
                    content: content,
                    buttons: [
                        {
                            action: "save",
                            label: "Update Ledger",
                            icon: "fa-solid fa-save",
                            default: true,
                            callback: async (ev, btn, dlg) => {
                                const html = dlg.element;
                                const newSource = html.querySelector('#new-actor-source').value;
                                const actionSelection = html.querySelector('#new-action-select').value;
                                const customName = html.querySelector('#new-action-custom').value;
                                const newName = actionSelection === "Other" ? customName : actionSelection;
                                
                                let selectedIds = [logId];
                                html.querySelectorAll('.mass-audit-cb:checked').forEach(cb => selectedIds.push(cb.value));

                                const transferLogStats = (oldStats, newStats, lEntry) => {
                                    if (!oldStats || !newStats) return;

                                    if (lEntry.type === "Damage" || lEntry.type === "Mitigation") {
                                        oldStats.damageDealt -= (lEntry.damageVal || 0);
                                        newStats.damageDealt += (lEntry.damageVal || 0);
                                        if (lEntry.result && lEntry.result.includes("💀")) {
                                            oldStats.kills = Math.max(0, oldStats.kills - 1); 
                                            newStats.kills++;
                                        }
                                    } 
                                    else if (lEntry.type === "Heal") {
                                        oldStats.healingDealt -= (lEntry.healVal || 0);
                                        newStats.healingDealt += (lEntry.healVal || 0);
                                    } 
                                    else if (lEntry.type === "Roll") {
                                        let poolMatch = lEntry.result ? lEntry.result.match(/Dice Pool:\s*(\d+)/) : null;
                                        if (poolMatch) {
                                            let rollTotal = parseInt(poolMatch[1]);
                                            oldStats.actualDamageRoll -= rollTotal;
                                            newStats.actualDamageRoll += rollTotal;
                                        }
                                        if (lEntry.detail) {
                                            let typeMatches = [...lEntry.detail.matchAll(/(\d+)\s+([a-zA-Z]+)/g)];
                                            typeMatches.forEach(m => {
                                                let val = parseInt(m[1]);
                                                let dType = m[2].toLowerCase();
                                                
                                                if (oldStats.damageTypes && oldStats.damageTypes[dType]) {
                                                    oldStats.damageTypes[dType].total -= val;
                                                    oldStats.damageTypes[dType].instances -= 1;
                                                }
                                                if (!newStats.damageTypes) newStats.damageTypes = {};
                                                if (!newStats.damageTypes[dType]) newStats.damageTypes[dType] = { instances: 0, total: 0 };
                                                newStats.damageTypes[dType].total += val;
                                                newStats.damageTypes[dType].instances += 1;
                                            });
                                        }
                                    } 
                                    else if (lEntry.type === "Attack" || lEntry.type === "Save" || lEntry.type === "Skill") {
                                        let res = lEntry.result || "";
                                        if (res.includes("CRITICALSUCCESS") || res.includes("CRITICAL SUCCESS")) { oldStats.crits = Math.max(0, oldStats.crits - 1); newStats.crits++; }
                                        else if (res.includes("SUCCESS")) { oldStats.hits = Math.max(0, oldStats.hits - 1); newStats.hits++; }
                                        else if (res.includes("CRITICALFAILURE") || res.includes("CRITICAL FAILURE")) { oldStats.critMisses = Math.max(0, oldStats.critMisses - 1); newStats.critMisses++; }
                                        else if (res.includes("FAILURE")) { oldStats.misses = Math.max(0, oldStats.misses - 1); newStats.misses++; }

                                        let d20Match = lEntry.detail ? lEntry.detail.match(/d20:\s*(\d+)/) : null;
                                        if (d20Match) {
                                            let d20Val = parseInt(d20Match[1]);
                                            if (d20Val === 20) { oldStats.nat20s = Math.max(0, oldStats.nat20s - 1); newStats.nat20s++; }
                                            if (d20Val === 1) { oldStats.nat1s = Math.max(0, oldStats.nat1s - 1); newStats.nat1s++; }
                                            if (d20Val >= 1 && d20Val <= 20) {
                                                if (oldStats.d20Rolls && oldStats.d20Rolls[d20Val - 1] > 0) oldStats.d20Rolls[d20Val - 1]--;
                                                if (!newStats.d20Rolls) newStats.d20Rolls = Array(20).fill(0);
                                                newStats.d20Rolls[d20Val - 1]++;
                                            }
                                        }
                                    }

                                    oldStats.history = oldStats.history.filter(h => h.id !== lEntry.id);
                                    let clonedHistoryEntry = foundry.utils.deepClone(lEntry);
                                    clonedHistoryEntry.source = newSource;
                                    clonedHistoryEntry.name = newName;
                                    clonedHistoryEntry.minion = null;
                                    newStats.history.push(clonedHistoryEntry);
                                };

                                selectedIds.forEach(targetId => {
                                    let lEntry = targetLedger.masterLog.find(l => l.id === targetId);
                                    if (!lEntry) return;

                                    let oldSource = lEntry.source;
                                    this.expandedActors[oldSource] = true;

                                    if (oldSource !== newSource) {
                                        transferLogStats(targetLedger.actors[oldSource], targetLedger.actors[newSource], lEntry);
                                    } else {
                                        let stats = targetLedger.actors[oldSource];
                                        if (stats) {
                                            let hist = stats.history.find(h => h.id === targetId);
                                            if (hist) {
                                                hist.name = newName;
                                                hist.minion = null;
                                            }
                                        }
                                    }
                                    lEntry.source = newSource;
                                    lEntry.name = newName;
                                    lEntry.minion = null;
                                });

                                this.expandedActors[newSource] = true;

                                if (dbName) {
                                    let db = game.settings.get('pf2e-holodeck', dbName);
                                    db[encName] = targetLedger;
                                    await game.settings.set('pf2e-holodeck', dbName, db);
                                }

                                this.render({ force: true });
                            }
                        },
                        { action: "cancel", label: "Cancel", icon: "fa-solid fa-times" }
                    ]
                });

                await dialog.render(true);
                const html = dialog.element;

                const sourceSelect = html.querySelector('#new-actor-source');
                const actionSelect = html.querySelector('#new-action-select');
                const customContainer = html.querySelector('#new-action-custom-container');
                const customInput = html.querySelector('#new-action-custom');

                const updateActionDropdown = () => {
                    const selectedActor = sourceSelect.value;
                    const abilities = actorAbilities[selectedActor] || [];
                    let options = abilities.map(a => `<option value="${a}" ${a === currentLogCoreName ? 'selected' : ''}>${a}</option>`).join("");
                    options += `<option value="Other" ${!abilities.includes(currentLogCoreName) ? 'selected' : ''}>Other (Custom)...</option>`;
                    
                    actionSelect.innerHTML = options;
                    
                    if (actionSelect.value === "Other") {
                        customContainer.style.display = "block";
                        customInput.value = currentLogCoreName;
                    } else {
                        customContainer.style.display = "none";
                        customInput.value = actionSelect.value;
                    }
                };

                if (sourceSelect && actionSelect) {
                    sourceSelect.addEventListener('change', updateActionDropdown);
                    actionSelect.addEventListener('change', () => {
                        if (actionSelect.value === "Other") {
                            customContainer.style.display = "block";
                            customInput.value = "";
                        } else {
                            customContainer.style.display = "none";
                            customInput.value = actionSelect.value;
                        }
                    });
                    updateActionDropdown();
                }

                const masterCb = html.querySelector('#mass-audit-master');
                if (masterCb) {
                    masterCb.addEventListener('change', (e) => {
                        html.querySelectorAll('.mass-audit-cb').forEach(cb => cb.checked = e.target.checked);
                    });
                }
            },
            exportData: async function() {
                if (!game.user.isGM) return ui.notifications.warn("Only the GM can archive to journals.");
                const hDb = game.settings.get('pf2e-holodeck', 'combatHistory') || {};
                const sDb = game.settings.get('pf2e-holodeck', 'holodeckHistory') || {};
                const eDb = game.settings.get('pf2e-holodeck', 'explorationHistory') || {};
                
                if (Object.keys(hDb).length === 0 && Object.keys(sDb).length === 0 && Object.keys(eDb).length === 0) return ui.notifications.warn("No data to archive.");

                const buildHtml = (db, title) => {
                    let htmlContent = `<h1 style="border-bottom: 2px solid #44aaff;">${title}</h1>`;
                    for (const [encounterName, data] of Object.entries(db)) {
                        htmlContent += `<h2>${encounterName}</h2><p><b>Total Damage:</b> ${data.totalDamage}</p>
                        <table border="1" cellpadding="5" cellspacing="0" style="width: 100%; border-collapse: collapse; font-size: 0.9em; text-align: left;">
                        <thead style="background: rgba(0,0,0,0.1);"><tr><th>Combatant</th><th>DMG Dealt</th><th>Kills</th><th>Mitigated</th><th>Rolls</th></tr></thead><tbody>`;
                        
                        const actors = Object.values(data.actors || {}).sort((a,b) => b.damageDealt - a.damageDealt);
                        for (const a of actors) {
                            const totalAttacks = (a.hits||0) + (a.misses||0) + (a.crits||0) + (a.critMisses||0);
                            const rawRolls = a.d20Rolls || Array(20).fill(0);
                            const totalD20s = rawRolls.reduce((sum, count) => sum + count, 0);
                            const displayedRolls = Math.max(totalAttacks, totalD20s);
                            
                            htmlContent += `<tr><td><b>${a.name}</b></td><td style="color: #aa4444;">${a.damageDealt || 0}</td>
                            <td>${a.kills || 0}</td><td style="color: #aaaaaa;">${a.mitigated || 0}</td><td>${displayedRolls}</td></tr>`;
                        }
                        htmlContent += `</tbody></table><hr>`;
                    }
                    return htmlContent;
                };

                const pages = [];
                if (Object.keys(hDb).length > 0) pages.push({ name: "Campaign Metrics", type: "text", text: { format: 1, content: buildHtml(hDb, "Campaign Combat Metrics") }});
                if (Object.keys(eDb).length > 0) pages.push({ name: "Exploration Logs", type: "text", text: { format: 1, content: buildHtml(eDb, "Out-of-Combat Exploration Logs") }});
                if (Object.keys(sDb).length > 0) pages.push({ name: "Classified Simulations", type: "text", text: { format: 1, content: buildHtml(sDb, "Holodeck Test Logs") }});

                const journal = await JournalEntry.create({ 
                    name: `Data Archives (${new Date().toLocaleDateString()})`, 
                    pages: pages,
                    flags: {
                        "pf2e-holodeck": {
                            archiveData: { combatHistory: hDb, explorationHistory: eDb, holodeckHistory: sDb }
                        }
                    }
                });
                
                if (journal) { journal.sheet.render(true); ui.notifications.info("Combat Forensics | Data archived to Journal successfully."); }
            },
            downloadJSON: async function() {
                if (!game.user.isGM) return ui.notifications.warn("Only the GM can download raw JSON databases.");
                const hDb = game.settings.get('pf2e-holodeck', 'combatHistory') || {};
                const sDb = game.settings.get('pf2e-holodeck', 'holodeckHistory') || {};
                const eDb = game.settings.get('pf2e-holodeck', 'explorationHistory') || {};
                
                if (Object.keys(hDb).length === 0 && Object.keys(sDb).length === 0 && Object.keys(eDb).length === 0) return ui.notifications.warn("No data to export.");

                const exportPayload = {
                    exportDate: new Date().toISOString(),
                    module: "pf2e-holodeck",
                    databases: {
                        combatHistory: hDb,
                        holodeckHistory: sDb,
                        explorationHistory: eDb
                    }
                };

                const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportPayload, null, 2));
                const downloadAnchorNode = document.createElement('a');
                downloadAnchorNode.setAttribute("href", dataStr);
                downloadAnchorNode.setAttribute("download", `combat-forensics-backup-${new Date().toISOString().split('T')[0]}.json`);
                document.body.appendChild(downloadAnchorNode); 
                downloadAnchorNode.click();
                downloadAnchorNode.remove();
                ui.notifications.info("Combat Forensics | JSON download initiated.");
            },
            importData: async function() {
                if (!game.user.isGM) return ui.notifications.warn("Only the GM can import archives.");

                const journals = game.journal.contents.filter(j => j.flags?.["pf2e-holodeck"]?.archiveData);
                let journalOptions = journals.map(j => `<option value="${j.id}">${j.name}</option>`).join("");
                
                let journalHtml = journals.length > 0 
                    ? `<div class="form-group" style="margin-bottom: 10px;">
                           <label style="font-weight: bold; color: #44aaff; display:block; margin-bottom:4px;">From Journal Archive:</label>
                           <div style="display:flex; gap: 5px;">
                               <select id="import-journal-select" style="flex:1; padding: 6px; background: #222; color: #eee; border: 1px solid #555; border-radius: 3px;">
                                   ${journalOptions}
                               </select>
                               <button type="button" id="btn-import-journal" style="flex: 0 0 auto; background: #113355; border: 1px solid #44aaff; color: #fff; cursor: pointer;">Load Journal</button>
                           </div>
                       </div>` 
                    : `<div style="color: #888; font-style: italic; margin-bottom: 10px;">No Journal Archives found. Export first.</div>`;

                const content = `
                    <div style="background: #0f0f15; color: #eee; padding: 15px; border: 1px solid #444; border-radius: 4px; font-family: 'Signika', sans-serif;">
                        <p style="margin-top: 0; color: #ccc; font-size: 0.9em;">Importing will safely append archived encounters into your current databases.</p>
                        ${journalHtml}
                        <hr style="border: 0; border-top: 1px dashed #444; margin: 15px 0;">
                        <div class="form-group">
                            <label style="font-weight: bold; color: #aa44ff; display:block; margin-bottom:4px;">From Local JSON File:</label>
                            <button type="button" id="btn-import-json" style="width: 100%; background: #331133; border: 1px solid #aa44ff; color: #fff; padding: 8px; cursor: pointer;">
                                <i class="fas fa-upload"></i> Select & Upload JSON Backup
                            </button>
                            <input type="file" id="json-upload-input" accept=".json" style="display: none;">
                        </div>
                    </div>
                `;

                const processImport = async (data) => {
                    if (!data || (!data.combatHistory && !data.combat && !data.explorationHistory && !data.holodeckHistory)) {
                        return ui.notifications.error("Combat Forensics | Invalid archive data format.");
                    }

                    const safeMergeDb = async (settingName, newData) => {
                        if (!newData || Object.keys(newData).length === 0) return;
                        let current = game.settings.get('pf2e-holodeck', settingName) || {};
                        let updated = { ...current };
                        for (const [key, value] of Object.entries(newData)) {
                            updated[key] = value;
                        }
                        await game.settings.set('pf2e-holodeck', settingName, updated);
                    };

                    await safeMergeDb('combatHistory', data.combatHistory || data.combat);
                    await safeMergeDb('explorationHistory', data.explorationHistory || data.exploration);
                    await safeMergeDb('holodeckHistory', data.holodeckHistory || data.sim);

                    ui.notifications.info("Combat Forensics | Data successfully imported and merged.");
                    this.render({ force: true });
                };

                const dialog = new foundry.applications.api.DialogV2({
                    window: { title: "Import Combat Archives" },
                    position: { width: 450 },
                    content: content,
                    buttons: [{ action: "close", label: "Close", icon: "fa-solid fa-times" }]
                });

                await dialog.render(true);
                const html = dialog.element;

                const btnJournal = html.querySelector('#btn-import-journal');
                if (btnJournal) {
                    btnJournal.addEventListener('click', async (e) => {
                        e.preventDefault();
                        const jId = html.querySelector('#import-journal-select').value;
                        const journal = game.journal.get(jId);
                        if (journal) {
                            const archiveData = journal.flags["pf2e-holodeck"].archiveData;
                            await processImport(archiveData);
                            dialog.close();
                        }
                    });
                }

                const btnJson = html.querySelector('#btn-import-json');
                const inputJson = html.querySelector('#json-upload-input');
                if (btnJson && inputJson) {
                    btnJson.addEventListener('click', (e) => {
                        e.preventDefault();
                        inputJson.click();
                    });

                    inputJson.addEventListener('change', (e) => {
                        const file = e.target.files[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = async (ev) => {
                            try {
                                const json = JSON.parse(ev.target.result);
                                const data = json.databases || json; 
                                await processImport(data);
                                dialog.close();
                            } catch (err) {
                                ui.notifications.error("Combat Forensics | Failed to parse JSON file.");
                                console.error(err);
                            }
                        };
                        reader.readAsText(file);
                    });
                }
            }
        }
    };

    static PARTS = {
        main: { template: "modules/pf2e-holodeck/templates/analytics.hbs" }
    };
    constructor(options={}) {
        const savedBounds = game.user.getFlag('pf2e-holodeck', 'windowBounds') || {};
        // Merge the saved bounds into the incoming options before calling super
        options.position = foundry.utils.mergeObject(options.position || {}, savedBounds, {inplace: false});
        super(options);
    }

    async close(options) {
        await game.user.setFlag('pf2e-holodeck', 'windowBounds', this.position);
        return super.close(options);
    }

    async _prepareContext(options) {
        this.viewMode = this.viewMode || 'overview';
        this.expandedActors = this.expandedActors || {};
        this.expandedLogs = this.expandedLogs || {};
        if (!this.selectedEncounter) {
            const isCombatActive = (canvas.scene && canvas.scene.getFlag('pf2e-holodeck', 'active')) || (game.combat && game.combat.active && game.combat.started);
            this.selectedEncounter = isCombatActive ? "current" : "exploration";
        }
        
        this.viewMode = this.viewMode || "overview";
        const isMeta = this.selectedEncounter.startsWith("meta");
        const isExploration = this.selectedEncounter === "exploration" || this.selectedEncounter.startsWith("meta-explore") || this.selectedEncounter.startsWith("[EXPLORE]");
        const isGM = game.user.isGM;

        const canAudit = game.user.role >= (game.settings.get('pf2e-holodeck', 'auditPermission') || 4);
        const showAdvanced = !(game.settings.get('pf2e-holodeck', 'simplifiedMetrics') || false);

        const historyDb = game.settings.get('pf2e-holodeck', 'combatHistory') || {};
        const exploreDb = game.settings.get('pf2e-holodeck', 'explorationHistory') || {};
        const simDb = isGM ? (game.settings.get('pf2e-holodeck', 'holodeckHistory') || {}) : {};
        
        const historyKeys = Object.keys(historyDb).reverse(); 
        const exploreKeys = Object.keys(exploreDb).reverse(); 
        const simKeys = Object.keys(simDb).reverse(); 

        let activeLedger = { actors: {}, masterLog: [], totalDamage: 0, maxRounds: 1 };

        let synergy = {
            guardianName: null, guardianTaunts: 0, guardianTriggers: 0,
            hunterName: null, hunterShots: 0, hunterDmg: 0,
            surgerName: null, surges: 0, surgeDmg: 0,
            wallName: null, wallMitigated: 0,
            dodgeKing: { name: "N/A", pct: 0, dodged: 0, total: 0 },
            saveKing: { name: "N/A", pct: 0, resisted: 0, total: 0 },
            meatShield: { name: null, coverProvided: 0 } // <-- ADD THIS LINE
        };
        if (isMeta) {
            let targetDb = historyDb;
            if (this.selectedEncounter === "meta-sim") targetDb = simDb;
            if (this.selectedEncounter === "meta-explore") targetDb = exploreDb;
            
            let cumulativeRounds = 0;
            
            Object.entries(targetDb).forEach(([encounterName, encounter]) => {
                let encMaxRounds = encounter.maxRounds || 1;
                
                let safeMasterLog = Array.isArray(encounter.masterLog) ? encounter.masterLog : Object.values(encounter.masterLog || {});

                if (safeMasterLog && safeMasterLog.length > 0) {
                    activeLedger.masterLog.push({ isDivider: true, encounterName: encounterName, round: cumulativeRounds + 1 });
                    
                    safeMasterLog.forEach(log => {
                        let adjustedLog = foundry.utils.deepClone(log);
                        adjustedLog.round += cumulativeRounds; 
                        activeLedger.masterLog.push(adjustedLog);
                    });
                }

                Object.values(encounter.actors || {}).forEach(a => {
                    let trueName = a.name || "Unknown";
                    if (!activeLedger.actors[trueName]) {
                        activeLedger.actors[trueName] = { 
                            name: trueName, type: a.type, level: a.level, isAlly: a.isAlly,
                            master: a.master || null,
                            damageDealt: 0, healingDealt: 0, hits: 0, misses: 0, crits: 0, critMisses: 0,
                            damageTakenTypes: {}, damageTakenSources: {}, healingReceivedSources: {}, mitigatedSources: {},
                            incomingAttacks: 0, incomingAttacksDodged: 0, incomingSaves: 0, incomingSavesResisted: 0,
                            advanced: { huntedShots: 0, huntedShotDmg: 0, taunts: 0, tauntTriggers: 0, surges: 0, surgeFriendlyDmg: 0, surgeTypes: {} },
                            nat1s: 0, nat20s: 0, kills: 0, mitigated: 0, heroPoints: 0, heroPointCrits: 0, expectedDamage: 0, actualDamageRoll: 0, damageTypes: {}, turnTimes: [], d20Rolls: Array(20).fill(0), history: [] 
                        };
                    }
                    let m = activeLedger.actors[trueName];
                    m.isAlly = m.isAlly || a.isAlly || a.type === "character" || a.type === "familiar";
                    m.master = m.master || a.master; 
                    m.damageDealt += (a.damageDealt || 0); m.healingDealt += (a.healingDealt || 0); m.hits += (a.hits || 0); m.misses += (a.misses || 0);
                    m.crits += (a.crits || 0); m.critMisses += (a.critMisses || 0); m.nat1s += (a.nat1s || 0); m.nat20s += (a.nat20s || 0);
                    m.kills += (a.kills || 0); m.mitigated += (a.mitigated || 0); m.heroPoints += (a.heroPoints || 0); m.heroPointCrits += (a.heroPointCrits || 0);
                    m.expectedDamage = (m.expectedDamage || 0) + (a.expectedDamage || 0);
                    m.actualDamageRoll = (m.actualDamageRoll || 0) + (a.actualDamageRoll || 0);
                    
                    m.incomingAttacks = (m.incomingAttacks || 0) + (a.incomingAttacks || 0);
                    m.incomingAttacksDodged = (m.incomingAttacksDodged || 0) + (a.incomingAttacksDodged || 0);
                    m.incomingSaves = (m.incomingSaves || 0) + (a.incomingSaves || 0);
                    m.incomingSavesResisted = (m.incomingSavesResisted || 0) + (a.incomingSavesResisted || 0);
                    
                    let safeTurnTimes = Array.isArray(a.turnTimes) ? a.turnTimes : Object.values(a.turnTimes || {});
                    if (safeTurnTimes.length) m.turnTimes.push(...safeTurnTimes);

                    let safeD20s = Array.isArray(a.d20Rolls) ? a.d20Rolls : Object.values(a.d20Rolls || {});
                    if (safeD20s.length) { for (let i = 0; i < 20; i++) { m.d20Rolls[i] += (safeD20s[i] || 0); } }
                    
                    if (a.damageTypes) {
                        for (let [dt, dData] of Object.entries(a.damageTypes)) {
                            if (!m.damageTypes[dt]) m.damageTypes[dt] = { instances: 0, total: 0 };
                            if (typeof dData === 'number') {
                                m.damageTypes[dt].total += dData;
                                m.damageTypes[dt].instances += 1;
                            } else {
                                m.damageTypes[dt].total += dData.total;
                                m.damageTypes[dt].instances += dData.instances;
                            }
                        }
                    }
                    
                    if (a.damageTakenSources) {
                        for (let [src, acts] of Object.entries(a.damageTakenSources)) {
                            if (!m.damageTakenSources[src]) m.damageTakenSources[src] = {};
                            for (let [act, val] of Object.entries(acts)) {
                                m.damageTakenSources[src][act] = (m.damageTakenSources[src][act] || 0) + val;
                            }
                        }
                    }

                    if (a.mitigatedSources) {
                        for (let [src, val] of Object.entries(a.mitigatedSources)) {
                            if (!m.mitigatedSources[src]) m.mitigatedSources[src] = 0;
                            m.mitigatedSources[src] += val;
                        }
                    }

                    if (a.advanced) {
                        m.advanced.providedCover = (m.advanced.providedCover || 0) + (a.advanced.providedCover || 0);
                        m.advanced.interruptedEnemy = (m.advanced.interruptedEnemy || 0) + (a.advanced.interruptedEnemy || 0);
    m.advanced.interruptedFriendly = (m.advanced.interruptedFriendly || 0) + (a.advanced.interruptedFriendly || 0);
                        m.advanced.huntedShots += (a.advanced.huntedShots || 0);
                        m.advanced.huntedShotDmg += (a.advanced.huntedShotDmg || 0);
                        m.advanced.taunts += (a.advanced.taunts || 0);
                        m.advanced.tauntTriggers += (a.advanced.tauntTriggers || 0);
                        m.advanced.surges += (a.advanced.surges || 0);
                        m.advanced.surgeFriendlyDmg += (a.advanced.surgeFriendlyDmg || 0);
                    }
                    
                    let safeHistory = Array.isArray(a.history) ? a.history : Object.values(a.history || {});
                    if (safeHistory.length) {
                        let adjustedHistory = safeHistory.map(h => ({...h, round: h.round + cumulativeRounds}));
                        m.history.push(...adjustedHistory);
                    }
                    if (a.type === "character" || a.type === "familiar") m.type = a.type;
                });
                
                activeLedger.totalDamage += (encounter.totalDamage || 0);
                cumulativeRounds += encMaxRounds;
            });
            activeLedger.maxRounds = cumulativeRounds || 1;
            
        } else if (this.selectedEncounter === "current") {
            if (!isGM && canvas.scene?.getFlag('pf2e-holodeck', 'active')) {} 
            else activeLedger = window.CombatParser.ledger;
        } else if (this.selectedEncounter === "exploration") {
            activeLedger = window.CombatParser.explorationLedger;
        } else {
            activeLedger = historyDb[this.selectedEncounter] || exploreDb[this.selectedEncounter] || simDb[this.selectedEncounter] || activeLedger;
        }

        if (activeLedger.masterLog && !Array.isArray(activeLedger.masterLog)) {
            activeLedger.masterLog = Object.values(activeLedger.masterLog);
        }
        Object.values(activeLedger.actors).forEach(a => {
            if (a.history && !Array.isArray(a.history)) a.history = Object.values(a.history);
            if (a.turnTimes && !Array.isArray(a.turnTimes)) a.turnTimes = Object.values(a.turnTimes);
            if (a.d20Rolls && !Array.isArray(a.d20Rolls)) a.d20Rolls = Object.values(a.d20Rolls);

            if (a.isAlly) {
                if (a.mitigated > synergy.wallMitigated) {
                    synergy.wallName = a.name;
                    synergy.wallMitigated = a.mitigated;
                }

                let dPct = a.incomingAttacks > 0 ? Math.round(((a.incomingAttacksDodged || 0) / a.incomingAttacks) * 100) : 0;
                let sPct = a.incomingSaves > 0 ? Math.round(((a.incomingSavesResisted || 0) / a.incomingSaves) * 100) : 0;

                if (a.incomingAttacks >= 2 && dPct > synergy.dodgeKing.pct) {
                    synergy.dodgeKing = { name: a.name, pct: dPct, dodged: a.incomingAttacksDodged || 0, total: a.incomingAttacks };
                } else if (a.incomingAttacks > 0 && synergy.dodgeKing.total === 0 && dPct >= synergy.dodgeKing.pct) {
                    synergy.dodgeKing = { name: a.name, pct: dPct, dodged: a.incomingAttacksDodged || 0, total: a.incomingAttacks };
                }

                if (a.incomingSaves >= 2 && sPct > synergy.saveKing.pct) {
                    synergy.saveKing = { name: a.name, pct: sPct, resisted: a.incomingSavesResisted || 0, total: a.incomingSaves };
                } else if (a.incomingSaves > 0 && synergy.saveKing.total === 0 && sPct >= synergy.saveKing.pct) {
                    synergy.saveKing = { name: a.name, pct: sPct, resisted: a.incomingSavesResisted || 0, total: a.incomingSaves };
                }
            }

            if (a.advanced) {
                if (a.advanced.taunts > synergy.guardianTaunts) {
                    synergy.guardianName = a.name;
                    synergy.guardianTaunts = a.advanced.taunts;
                    synergy.guardianTriggers = a.advanced.tauntTriggers;
                }
                if (a.advanced.huntedShots > synergy.hunterShots) {
                    synergy.hunterName = a.name;
                    synergy.hunterShots = a.advanced.huntedShots;
                    synergy.hunterDmg = a.advanced.huntedShotDmg;
                }
                if (a.advanced.surges > synergy.surges) {
                    synergy.surgerName = a.name;
                    synergy.surges = a.advanced.surges;
                    synergy.surgeDmg = a.advanced.surgeFriendlyDmg;
                }
                // --- NEW MEAT SHIELD TRACKING ---
                if (a.advanced.providedCover > synergy.meatShield.coverProvided) {
                    synergy.meatShield.name = a.name;
                    synergy.meatShield.coverProvided = a.advanced.providedCover;
                }
            }
        });

        let needsMigrationSave = false;
        activeLedger.masterLog.forEach(log => {
            if (!log.isDivider && !log.isTurnSummary && !log.id) {
                log.id = foundry.utils.randomID();
                let stats = activeLedger.actors[log.source];
                if (stats && stats.history) {
                    let hist = stats.history.find(h => h.round === log.round && h.name === log.name && h.type === log.type && !h.id);
                    if (hist) hist.id = log.id;
                }
                needsMigrationSave = true;
            }
        });

        if (needsMigrationSave && isGM && !isMeta && this.selectedEncounter !== "current" && this.selectedEncounter !== "exploration") {
            let hDb = foundry.utils.deepClone(historyDb);
            let eDb = foundry.utils.deepClone(exploreDb);
            let sDb = foundry.utils.deepClone(simDb);
            
            if (hDb[this.selectedEncounter]) { 
                hDb[this.selectedEncounter] = activeLedger; 
                game.settings.set('pf2e-holodeck', 'combatHistory', hDb); 
            } else if (eDb[this.selectedEncounter]) { 
                eDb[this.selectedEncounter] = activeLedger; 
                game.settings.set('pf2e-holodeck', 'explorationHistory', eDb); 
            } else if (sDb[this.selectedEncounter]) { 
                sDb[this.selectedEncounter] = activeLedger; 
                game.settings.set('pf2e-holodeck', 'holodeckHistory', sDb); 
            }
        }

        let maxRounds = activeLedger.maxRounds || 1;
        let totalDamage = activeLedger.totalDamage || 1;
        
        let logCounter = 0;
        let partyActions = 0, enemyActions = 0;

        const formatTime = (secs) => {
            const m = Math.floor(secs / 60);
            const s = Math.floor(secs % 60);
            return m > 0 ? `${m}m ${s}s` : `${s}s`;
        };

        let processedLogs = activeLedger.masterLog.map(log => {
            if (log.isDivider) return log; 
            
            let actorData = activeLedger.actors[log.source];
            let isParty = actorData ? actorData.isAlly : false;

            if (log.isTurnSummary) {
                return { ...log, isParty: isParty, formattedTime: formatTime(log.duration) };
            }

            let parts = log.name ? log.name.split(/(?: - | \| )/) : [""];
            let mainTitle = parts[0] ? parts[0].trim() : "";
            
            if (!mainTitle) {
                if (log.type === "Damage") mainTitle = "Damage Application";
                else if (log.type === "Roll") mainTitle = "Dice Roll";
                else mainTitle = "Action";
            }
            
            let tags = log.tags && log.tags.length > 0 ? log.tags : parts.slice(1).map(p => p.trim()).filter(p => p);
            
            if (log.tags && log.tags.length > 0) {
                parts.slice(1).forEach(p => {
                    let pt = p.trim();
                    if (pt && !tags.includes(pt)) tags.push(pt);
                });
            }
            
            if (isParty) partyActions++;
            else enemyActions++;

            let isSuspect = false;
            let suspectReason = "";
            let targetData = activeLedger.actors[log.target];
            let hasValidTarget = log.target && log.target !== "None" && log.target !== "Unknown / AoE";
            
            if (log.source !== "Environment" && targetData && hasValidTarget) {
                let isTargetParty = targetData.isAlly;
                if (log.type === "Damage") {
                    if (isParty === isTargetParty) {
                        isSuspect = true;
                        suspectReason = log.source === log.target ? "Self-Harm: Attacker damaged themselves." : "Friendly Fire: Damaged an allied combatant.";
                    }
                } else if (log.type === "Heal") {
                    if (isParty !== isTargetParty) {
                        isSuspect = true;
                        suspectReason = "Traitor Healing: Restored HP to an enemy combatant.";
                    }
                }
            }

            return { ...log, mainTitle, tags, isParty, isSuspect, suspectReason, hasValidTarget };
        });

        processedLogs.forEach(l => {
            if (l.round > maxRounds) maxRounds = l.round;
        });

        let rounds = [];
        let partyDamagePerRound = [];
        let enemyDamagePerRound = [];
        let maxGraphDamage = 10; 

        for (let i = 1; i <= maxRounds; i++) {
            let rLogs = processedLogs.filter(l => l.round === i);
            let pDmg = 0; let eDmg = 0;

            if (rLogs.length > 0) rounds.push({ roundNumber: i, logs: rLogs });

            rLogs.forEach(l => {
                if (l.type === "Damage") {
                    if (l.isParty) pDmg += l.damageVal;
                    else eDmg += l.damageVal;
                }
            });

            partyDamagePerRound.push(pDmg);
            enemyDamagePerRound.push(eDmg);
            
            if (pDmg > maxGraphDamage) maxGraphDamage = pDmg;
            if (eDmg > maxGraphDamage) maxGraphDamage = eDmg;
        }

        let partyPoints = [], enemyPoints = [], pDots = [], eDots = [], xLabels = [];
        let usableWidth = 700, usableHeight = 110, xOffset = 30, yOffset = 130; 

        for (let i = 0; i < maxRounds; i++) {
            let x = maxRounds === 1 ? (usableWidth / 2) + xOffset : (i / (maxRounds - 1)) * usableWidth + xOffset;
            let pY = yOffset - ((partyDamagePerRound[i] || 0) / maxGraphDamage) * usableHeight;
            let eY = yOffset - ((enemyDamagePerRound[i] || 0) / maxGraphDamage) * usableHeight;

            partyPoints.push(`${x},${pY}`);
            enemyPoints.push(`${x},${eY}`);
            pDots.push({x, y: pY});
            eDots.push({x, y: eY});
            xLabels.push({ x: x, round: i + 1 });
        }

        const pcs = [];
        const npcs = [];
        const rawPcs = [];
        const rawNpcs = [];
        
        let luckiest = { name: "None", avg: 0 };
        let unluckiest = { name: "None", avg: 21 };
        let partyActualDmg = 0, partyExpectedDmg = 0;
        let enemyActualDmg = 0, enemyExpectedDmg = 0;
        let enemyDamageTypesPool = {};
        
        let partyTurnTotalSeconds = 0;
        let partyTurnCount = 0;
        let enemyTurnTotalSeconds = 0;
        let enemyTurnCount = 0;

        let totalCombatTimeSeconds = 0;
        let pcTimeMap = {};
        let gmTimeTotal = 0;

        Object.values(activeLedger.actors).forEach(a => {
            const rawRolls = a.d20Rolls || Array(20).fill(0);
            
            let totalD20Sum = 0;
            let totalD20sRolled = 0;
            rawRolls.forEach((count, idx) => {
                totalD20Sum += (idx + 1) * count;
                totalD20sRolled += count;
            });
            
            let avgD20Val = totalD20sRolled > 0 ? (totalD20Sum / totalD20sRolled) : 0;
            let avgD20Display = totalD20sRolled > 0 ? avgD20Val.toFixed(1) : "N/A";
            
            if (totalD20sRolled >= 3) {
                if (avgD20Val > luckiest.avg) luckiest = { name: a.name, avg: avgD20Val };
                if (avgD20Val < unluckiest.avg) unluckiest = { name: a.name, avg: avgD20Val };
            }
            
            const totalAttacks = (a.hits || 0) + (a.misses || 0) + (a.crits || 0) + (a.critMisses || 0);
            const accuracy = totalAttacks > 0 ? Math.round((((a.hits || 0) + (a.crits || 0)) / totalAttacks) * 100) : 0;
            const successRate = accuracy; 
            const totalChecks = Math.max(totalAttacks, totalD20sRolled);

            let isAlly = a.isAlly;

            let tSum = 0;
            let tCount = 0;
            let maxTime = 0;
            if (a.turnTimes) {
                a.turnTimes.forEach(s => {
                    tSum += s;
                    tCount++;
                    if (s > maxTime) maxTime = s;
                });
            }
            
            totalCombatTimeSeconds += tSum;
            if (isAlly) {
                pcTimeMap[a.name] = (pcTimeMap[a.name] || 0) + tSum;
            } else {
                gmTimeTotal += tSum;
            }

            let totalTurnTimeStr = formatTime(tSum);
            let avgTurnTimeStr = tCount > 0 ? formatTime(Math.round(tSum/tCount)) : "0s";
            let maxTurnTimeStr = maxTime > 0 ? formatTime(maxTime) : "0s";

            const d20Max = Math.max(...rawRolls, 1);
            const d20Graph = rawRolls.map((count, index) => {
                const val = index + 1;
                let color = "#44aaff";
                if (val === 1) color = "#ff6666";
                if (val === 20) color = "#ffcc00";
                return { value: val, count: count, height: Math.round((count / d20Max) * 100), color: color };
            });

            let abilityTotals = {};
            let actionDamageMap = {};
            let actionHealMap = {};
            
            if (a.history) {
                a.history.forEach(h => {
                    let cleanName = h.name ? h.name.split(/(?: - | \| )/)[0].trim().replace(/\s*\([^)]*$/, "").replace(/^(?:Damage Roll:\s*|Roll:\s*)/i, "").trim() : "Unknown Action";
                    let aName = h.minion ? `[${h.minion}] ${cleanName}` : cleanName;

                    if (!abilityTotals[aName]) abilityTotals[aName] = { name: aName, damage: 0, healing: 0, casts: 0, damageInstances: 0 };
                    
                    if (h.type === "Damage" || h.type === "Mitigation") {
                        let key = `${h.round}_${h.name}`;
                        if (!actionDamageMap[key]) actionDamageMap[key] = 0;
                        actionDamageMap[key] += h.damageVal;
                        abilityTotals[aName].damage += h.damageVal;
                        if (h.damageVal > 0) abilityTotals[aName].damageInstances += 1;
                    }
                    if (h.type === "Heal") {
                        let key = `${h.round}_${h.name}`;
                        if (!actionHealMap[key]) actionHealMap[key] = 0;
                        actionHealMap[key] += h.healVal;
                        abilityTotals[aName].healing += h.healVal;
                    }
                    if (h.type === "Roll" || h.type === "Attack" || h.type === "Save" || h.type === "Skill") {
                        abilityTotals[aName].casts += 1;
                    } else if (h.damageVal === 0 && h.healVal === 0) {
                        abilityTotals[aName].casts += 1;
                    }
                });
            }
            
            let abilityBreakdown = Object.values(abilityTotals)
                .filter(ab => ab.damage > 0 || ab.healing > 0 || ab.casts > 0)
                .map(ab => {
                    return { 
                        ...ab, 
                        dmgPct: a.damageDealt > 0 ? Math.round((ab.damage / a.damageDealt) * 100) : 0,
                        hasBoth: ab.damage > 0 && ab.healing > 0
                    };
                })
                .sort((x, y) => (y.damage + y.healing) - (x.damage + x.healing));

            let maxDamageDealt = 0;
            Object.values(actionDamageMap).forEach(v => { if (v > maxDamageDealt) maxDamageDealt = v; });
            let maxHealDealt = 0;
            Object.values(actionHealMap).forEach(v => { if (v > maxHealDealt) maxHealDealt = v; });

            let takenDamageMap = {};
            activeLedger.masterLog.forEach(log => {
                if (!log.isDivider && log.target === a.name && (log.type === "Damage" || log.type === "Mitigation")) {
                    let key = `${log.round}_${log.source}_${log.name}`;
                    if (!takenDamageMap[key]) takenDamageMap[key] = 0;
                    takenDamageMap[key] += log.damageVal;
                }
            });
            let maxDamageTaken = 0;
            Object.values(takenDamageMap).forEach(v => { if (v > maxDamageTaken) maxDamageTaken = v; });

            let mostRolledNumber = "N/A";
            const maxRollCount = Math.max(...rawRolls);
            if (maxRollCount > 0) {
                const frequentRolls = [];
                rawRolls.forEach((count, idx) => { if (count === maxRollCount) frequentRolls.push(idx + 1); });
                mostRolledNumber = frequentRolls.join(', ');
            }
            
            if (isAlly) {
                partyActualDmg += (a.actualDamageRoll || 0);
                partyExpectedDmg += (a.expectedDamage || 0);
                partyTurnTotalSeconds += tSum;
                partyTurnCount += tCount;
            } else {
                enemyActualDmg += (a.actualDamageRoll || 0);
                enemyExpectedDmg += (a.expectedDamage || 0);
                enemyTurnTotalSeconds += tSum;
                enemyTurnCount += tCount;
                if (a.damageTypes) {
                    for (let [dt, dData] of Object.entries(a.damageTypes)) {
                        if (!enemyDamageTypesPool[dt]) enemyDamageTypesPool[dt] = { instances: 0, total: 0 };
                        if (typeof dData === 'number') {
                            enemyDamageTypesPool[dt].instances += 1;
                            enemyDamageTypesPool[dt].total += dData;
                        } else {
                            enemyDamageTypesPool[dt].instances += (dData.instances || 0);
                            enemyDamageTypesPool[dt].total += (dData.total || 0);
                        }
                    }
                }
            }

            let damageSources = [];
            if (a.damageTakenSources) {
                Object.entries(a.damageTakenSources).forEach(([src, actions]) => {
                    let actArr = Object.entries(actions).map(([aname, aval]) => ({ name: aname, value: aval })).sort((x, y) => y.value - x.value);
                    let srcTotal = actArr.reduce((sum, act) => sum + act.value, 0);
                    let srcMit = (a.mitigatedSources && a.mitigatedSources[src]) ? a.mitigatedSources[src] : 0;
                    damageSources.push({ source: src, total: srcTotal, mitigated: srcMit, actions: actArr });
                });
                damageSources.sort((x, y) => y.total - x.total);
            }
            
            let healingSources = [];
            if (a.healingReceivedSources) {
                Object.entries(a.healingReceivedSources).forEach(([src, actions]) => {
                    let actArr = Object.entries(actions).map(([aname, aval]) => ({ name: aname, value: aval })).sort((x, y) => y.value - x.value);
                    let srcTotal = actArr.reduce((sum, act) => sum + act.value, 0);
                    healingSources.push({ source: src, total: srcTotal, actions: actArr });
                });
                healingSources.sort((x, y) => y.total - x.total);
            }

            let adv = a.advanced || {};
            adv.isTopHunter = synergy.hunterName === a.name && adv.huntedShots > 0;
            adv.isTopGuardian = synergy.guardianName === a.name && adv.taunts > 0;
            adv.isTopSurger = synergy.surgerName === a.name && adv.surges > 0;

            let dodgeChance = a.incomingAttacks > 0 ? Math.round(((a.incomingAttacksDodged || 0) / a.incomingAttacks) * 100) : 0;
            let dodgeTooltip = `The number of times a creature failed to break your AC. Total Attacks Taken: ${a.incomingAttacks || 0}, Dodged: ${a.incomingAttacksDodged || 0}`;

            let saveChance = a.incomingSaves > 0 ? Math.round(((a.incomingSavesResisted || 0) / a.incomingSaves) * 100) : 0;
            let saveTooltip = `The number of times you resisted hostile effects. Total Saves Attempted: ${a.incomingSaves || 0}, Resisted: ${a.incomingSavesResisted || 0}`;

            let takenPieSlices = [];
            let takenLegendItems = [];

            let totalApplied = 0;
            if (a.damageTakenSources) {
                Object.values(a.damageTakenSources).forEach(src => {
                    Object.values(src).forEach(val => totalApplied += val);
                });
            }

            let totalMitigated = a.mitigated || 0;
            let totalThreat = totalApplied + totalMitigated;

            if (totalThreat > 0) {
                let tCumAngle = 0;
                const addSlice = (name, val, color) => {
                    if (val <= 0) return;
                    let pct = (val / totalThreat) * 100;
                    let tooltip = `${name.toUpperCase()}: ${val} (${pct.toFixed(1)}%)`;
                    let sliceAngle = (val / totalThreat) * (Math.PI * 2);

                    if (val === totalThreat) {
                        takenPieSlices.push({ isFull: true, path: "M 50 0 A 50 50 0 1 1 49.9 0 Z", color, tooltip });
                    } else {
                        let startX = 50 + 50 * Math.cos(tCumAngle);
                        let startY = 50 + 50 * Math.sin(tCumAngle);
                        tCumAngle += sliceAngle;
                        let endX = 50 + 50 * Math.cos(tCumAngle);
                        let endY = 50 + 50 * Math.sin(tCumAngle);
                        let largeArc = sliceAngle > Math.PI ? 1 : 0;
                        let path = `M 50 50 L ${startX} ${startY} A 50 50 0 ${largeArc} 1 ${endX} ${endY} Z`;
                        takenPieSlices.push({ isFull: false, path, color, tooltip });
                    }
                    takenLegendItems.push({ name: name.toUpperCase(), color, tooltip });
                };

                addSlice("Applied DMG", totalApplied, "#ff6666");
                addSlice("Mitigated (Blocked)", totalMitigated, "#44aaff");
            }

            const combatantData = { 
                ...a, healingDealt: a.healingDealt || 0, accuracy, d20Graph, 
                maxDamageDealt, maxDamageTaken, maxHealDealt, avgD20Display, totalChecks, successRate, totalTurnTimeStr, avgTurnTimeStr, maxTurnTimeStr, isAlly,
                abilityBreakdown, damageSources, healingSources, 
                dodgeChance, dodgeTooltip, saveChance, saveTooltip, incomingAttacks: a.incomingAttacks, incomingSaves: a.incomingSaves,
                takenPieSlices,
                takenLegendItems,
                advanced: adv,
                logs: processedLogs.filter(l => !l.isDivider && !l.isTurnSummary && l.source === a.name)
            };
            
            if (isAlly) rawPcs.push(combatantData);
            else if (isGM || showAdvanced) rawNpcs.push(combatantData);
        });

        let masterMap = {};
        rawPcs.forEach(p => masterMap[p.name] = p);
        rawNpcs.forEach(p => masterMap[p.name] = p);

        [...rawPcs, ...rawNpcs].forEach(p => {
            if (!p.master) {
                let liveAct = game.actors.find(act => act.name === p.name);
                if (liveAct && liveAct.flags?.pf2e?.master?.id) {
                    let m = game.actors.get(liveAct.flags.pf2e.master.id);
                    if (m) p.master = m.name;
                }
            }
        });

        const processMinions = (arr, finalArr) => {
            arr.forEach(p => {
                if (p.master && masterMap[p.master]) {
                    let master = masterMap[p.master];
                    if (!master.minions) master.minions = [];
                    master.minions.push(p);

           
                    master.damageDealt += (p.damageDealt || 0);
                    master.healingDealt += (p.healingDealt || 0);
                    master.kills += (p.kills || 0);
                    master.hits += (p.hits || 0);
                    master.misses += (p.misses || 0);
                    master.crits += (p.crits || 0);
                    master.critMisses += (p.critMisses || 0);
                    master.actualDamageRoll = (master.actualDamageRoll || 0) + (p.actualDamageRoll || 0);
                    master.expectedDamage = (master.expectedDamage || 0) + (p.expectedDamage || 0);
                    
          
                    const totalAttacks = master.hits + master.misses + master.crits + master.critMisses;
                    master.accuracy = totalAttacks > 0 ? Math.round(((master.hits + master.crits) / totalAttacks) * 100) : 0;
                    master.successRate = master.accuracy;
                } else {
                    finalArr.push(p);
                }
            });
        };

        processMinions(rawPcs, pcs);
        processMinions(rawNpcs, npcs);

        pcs.forEach(p => {
            p.damagePercent = Math.round((p.damageDealt / totalDamage) * 100) || 0;
            p.dpr = Math.round(p.damageDealt / maxRounds) || 0;
        });
        npcs.forEach(p => {
            p.damagePercent = Math.round((p.damageDealt / totalDamage) * 100) || 0;
            p.dpr = Math.round(p.damageDealt / maxRounds) || 0;
        });

        pcs.sort((a, b) => b.damageDealt - a.damageDealt);
        npcs.sort((a, b) => b.damageDealt - a.damageDealt);
        
        let actorGroups = [];
        [...pcs, ...npcs].forEach(a => {
            let aLogs = processedLogs.filter(l => !l.isDivider && !l.isTurnSummary && l.source === a.name);
            actorGroups.push({ 
                name: a.name, 
                isParty: a.isAlly, 
                canViewActor: a.isAlly || isGM || showAdvanced,
                logs: aLogs,
                totalTurnTimeStr: a.totalTurnTimeStr,
                avgTurnTimeStr: a.avgTurnTimeStr,
                maxTurnTimeStr: a.maxTurnTimeStr,
                abilityBreakdown: a.abilityBreakdown
            });
        });
        actorGroups.sort((a, b) => b.isParty - a.isParty);

        let timeEntries = [];
        if (gmTimeTotal > 0) timeEntries.push({ name: "GM / Enemies", time: gmTimeTotal, color: "#ff4444" });
        let pcColors = ["#44aaff", "#44ffaa", "#ffff44", "#aa44ff", "#ffaa00", "#ff44aa", "#44ffff", "#ffffff"];
        let pColorIdx = 0;
        
        Object.entries(pcTimeMap).sort((a,b) => b[1] - a[1]).forEach(([name, time]) => {
            if (time > 0) {
                timeEntries.push({ name: name, time: time, color: pcColors[pColorIdx % pcColors.length] });
                pColorIdx++;
            }
        });

        let timePieSlices = [];
        let timeLegendItems = [];
        let timeCumulativeAngle = 0;

        if (totalCombatTimeSeconds > 0) {
            timeEntries.forEach(entry => {
                let pctTime = (entry.time / totalCombatTimeSeconds) * 100;
                let tooltip = `${entry.name} | Total Time: ${formatTime(entry.time)} (${pctTime.toFixed(1)}%)`;
                let sliceAngle = (entry.time / totalCombatTimeSeconds) * (Math.PI * 2);

                if (entry.time === totalCombatTimeSeconds) {
                    timePieSlices.push({ isFull: true, path: "M 50 0 A 50 50 0 1 1 49.9 0 Z", color: entry.color, tooltip });
                } else {
                    let startX = 50 + 50 * Math.cos(timeCumulativeAngle);
                    let startY = 50 + 50 * Math.sin(timeCumulativeAngle);
                    timeCumulativeAngle += sliceAngle;
                    let endX = 50 + 50 * Math.cos(timeCumulativeAngle);
                    let endY = 50 + 50 * Math.sin(timeCumulativeAngle);
                    let largeArc = sliceAngle > Math.PI ? 1 : 0;
                    let path = `M 50 50 L ${startX} ${startY} A 50 50 0 ${largeArc} 1 ${endX} ${endY} Z`;
                    timePieSlices.push({ isFull: false, path, color: entry.color, tooltip });
                }
                timeLegendItems.push({ name: entry.name, color: entry.color, tooltip, formattedTime: formatTime(entry.time) });
            });
        }

        let partyPaceStr = partyTurnCount > 0 ? formatTime(Math.round(partyTurnTotalSeconds/partyTurnCount)) : "N/A";
        let enemyPaceStr = enemyTurnCount > 0 ? formatTime(Math.round(enemyTurnTotalSeconds/enemyTurnCount)) : "N/A";

        let partySkew = partyExpectedDmg > 0 ? Math.round(((partyActualDmg / partyExpectedDmg) - 1) * 100) : 0;
        let enemySkew = enemyExpectedDmg > 0 ? Math.round(((enemyActualDmg / enemyExpectedDmg) - 1) * 100) : 0;
        
        let totalEnemyInstances = 0;
        let totalEnemyTypedDamage = 0;
        Object.values(enemyDamageTypesPool).forEach(d => {
            totalEnemyInstances += d.instances;
            totalEnemyTypedDamage += d.total;
        });

        let pieSlices = [];
        let legendItems = [];
        let colors = ["#ff4444", "#44aaff", "#ffaa00", "#aa44ff", "#44ffaa", "#ff44aa", "#ffff44", "#44ffff"];
        let colorIndex = 0;
        let cumulativeAngle = 0; 
        
        let sortedEnemyTypes = Object.entries(enemyDamageTypesPool).sort((a,b) => b[1].instances - a[1].instances);

        if (totalEnemyInstances > 0) {
            sortedEnemyTypes.forEach(([dt, dData]) => {
                let pctInstances = (dData.instances / totalEnemyInstances) * 100;
                let pctDamage = totalEnemyTypedDamage > 0 ? (dData.total / totalEnemyTypedDamage) * 100 : 0;
                let tooltip = `${dt.toUpperCase()} | Instances: ${dData.instances} (${pctInstances.toFixed(1)}%) | Dmg: ${dData.total} (${pctDamage.toFixed(1)}%)`;
                let sliceAngle = (dData.instances / totalEnemyInstances) * (Math.PI * 2);
                
                if (dData.instances === totalEnemyInstances) {
                    pieSlices.push({ isFull: true, path: "M 50 0 A 50 50 0 1 1 49.9 0 Z", color: colors[colorIndex % colors.length], tooltip });
                } else {
                    let startX = 50 + 50 * Math.cos(cumulativeAngle);
                    let startY = 50 + 50 * Math.sin(cumulativeAngle);
                    cumulativeAngle += sliceAngle;
                    let endX = 50 + 50 * Math.cos(cumulativeAngle);
                    let endY = 50 + 50 * Math.sin(cumulativeAngle);
                    let largeArc = sliceAngle > Math.PI ? 1 : 0;
                    let path = `M 50 50 L ${startX} ${startY} A 50 50 0 ${largeArc} 1 ${endX} ${endY} Z`;
                    pieSlices.push({ isFull: false, path, color: colors[colorIndex % colors.length], tooltip });
                }
                legendItems.push({ name: dt.toUpperCase(), color: colors[colorIndex % colors.length], tooltip });
                colorIndex++;
            });
        }

        let difficultyStr = "Trivial";
        let diffColor = "#44ff44"; 
        let totalXP = 0, partyLevel = 1, partySize = 4;
        let truePcs = pcs.filter(p => p.type === "character"); 
        
        if (isMeta) {
            difficultyStr = "Meta Aggregate";
            diffColor = "#ffaa00";
        } else if (truePcs.length === 0) {
            difficultyStr = "N/A (No PCs)";
            diffColor = "#888";
        } else {
            partySize = truePcs.length;
            partyLevel = Math.max(...truePcs.map(p => parseInt(p.level) || 1));
            
            npcs.forEach(npc => {
                let levelDiff = (parseInt(npc.level) || 0) - partyLevel;
                if (levelDiff < -4) totalXP += 0; 
                else if (levelDiff === -4) totalXP += 10;
                else if (levelDiff === -3) totalXP += 15;
                else if (levelDiff === -2) totalXP += 20;
                else if (levelDiff === -1) totalXP += 30;
                else if (levelDiff === 0) totalXP += 40;
                else if (levelDiff === 1) totalXP += 60;
                else if (levelDiff === 2) totalXP += 80;
                else if (levelDiff === 3) totalXP += 120;
                else if (levelDiff >= 4) totalXP += 160;
            });

            let adj = partySize - 4;
            let trivial = 40 + (adj * 10), low = 60 + (adj * 15), mod = 80 + (adj * 20), sev = 120 + (adj * 30), ext = 160 + (adj * 40);

            if (totalXP >= ext) { difficultyStr = "Extreme"; diffColor = "#ff4444"; } 
            else if (totalXP >= sev) { difficultyStr = "Severe"; diffColor = "#ff6600"; } 
            else if (totalXP >= mod) { difficultyStr = "Moderate"; diffColor = "#ffaa00"; } 
            else if (totalXP >= low) { difficultyStr = "Low"; diffColor = "#aaff44"; } 
            else { difficultyStr = "Trivial"; diffColor = "#44ff44"; }
        }

        return { 
            viewMode: this.viewMode,
            expandedActors: this.expandedActors,
            expandedLogs: this.expandedLogs,
            hasData: Object.keys(activeLedger.actors).length > 0,
            isGM, canAudit, showAdvanced, isExploration, isMeta, viewMode: this.viewMode,
            pcs, npcs, rounds, actorGroups,
            historyKeys, exploreKeys, simKeys, selectedEncounter: this.selectedEncounter,
            stats: {
                partyCount: pcs.length, enemyCount: npcs.length,
                partyActions, enemyActions, difficultyStr, diffColor, partyLevel, partySize, totalXP,
                totalEncounterTimeStr: formatTime(totalCombatTimeSeconds)
            },
            pitBoss: {
                luckiestName: luckiest.avg > 0 ? luckiest.name : "N/A", luckiestAvg: luckiest.avg > 0 ? luckiest.avg.toFixed(1) : "-",
                unluckiestName: unluckiest.avg < 21 ? unluckiest.name : "N/A", unluckiestAvg: unluckiest.avg < 21 ? unluckiest.avg.toFixed(1) : "-",
                partySkewStr: partySkew > 0 ? `+${partySkew}%` : `${partySkew}%`, partySkewColor: partySkew > 0 ? "#44ff44" : (partySkew < 0 ? "#ff6666" : "#888"),
                enemySkewStr: enemySkew > 0 ? `+${enemySkew}%` : `${enemySkew}%`, enemySkewColor: enemySkew > 0 ? "#44ff44" : (enemySkew < 0 ? "#ff6666" : "#888"),
                pieSlices, legendItems, partyPaceStr, enemyPaceStr,
                timePieSlices, timeLegendItems, synergy:synergy
            },
            graph: {
                partyPoints: partyPoints.join(" "), enemyPoints: enemyPoints.join(" "),
                pDots, eDots, xLabels, maxDamage: maxGraphDamage, halfDamage: Math.round(maxGraphDamage / 2)
            }
        };
    }

   static PARTS = { main: { template: "modules/pf2e-holodeck/templates/analytics.hbs" } };

    _onRender(context, options) {
        super._onRender(context, options);
        const detailsElements = this.element.querySelectorAll('details');
        detailsElements.forEach(el => {
            el.addEventListener('toggle', (e) => {
                const target = e.currentTarget;
                if (target.dataset.actor) this.expandedActors[target.dataset.actor] = target.open;
                else if (target.dataset.logId) this.expandedLogs[target.dataset.logId] = target.open;
            });
        });

        const selector = this.element.querySelector('#analytics-selector');
        if (selector) {
            selector.addEventListener('change', (e) => {
                this.selectedEncounter = e.target.value;
                this.render({ force: true });
            });
        }
    }
}
window.CombatForensicsApp = CombatForensicsApp;

Hooks.once('init', () => {
    game.settings.register('pf2e-holodeck', 'activeTactical', { name: "Active Combat Backup", scope: 'world', config: false, type: window.CombatLedgerData, default: {} });
    game.settings.register('pf2e-holodeck', 'simplifiedMetrics', { name: "Simplified Metrics", hint: "Hides advanced analytics (Pit Boss charts, ability profiles) to focus only on raw damage and rolls. Ideal for keeping the UI clean for players.", scope: 'world', config: true, type: Boolean, default: false });
    game.settings.register('pf2e-holodeck', 'auditPermission', { name: "Attribution Audit Role", hint: "The minimum Foundry user role allowed to reassign timeline damage and swap actor allegiances.", scope: 'world', config: true, type: Number, choices: { 1: "Player", 2: "Trusted Player", 3: "Assistant GM", 4: "Game Master" }, default: 4 });

    game.keybindings.register('pf2e-holodeck', 'toggle-analytics', {
        name: "Toggle Combat Forensics", hint: "Instantly opens or closes the Combat Forensics dashboard.",
        editable: [{ key: "KeyA", modifiers: ["Shift"] }], restricted: true, 
        onDown: () => {
            if (!window.combatForensicsInstance) window.combatForensicsInstance = new window.CombatForensicsApp();
            if (window.combatForensicsInstance.rendered) window.combatForensicsInstance.close();
            else window.combatForensicsInstance.render({force: true});
            return true; 
        }
    });
});

Hooks.once('ready', () => {
    window.CombatParser.restoreLiveBackup();
    if (game.user.isGM) setInterval(() => { window.CombatParser.saveExplorationArchive(); }, 30 * 60 * 1000); 
});

Hooks.on('canvasReady', () => {
    if (game.user.isGM) window.CombatParser.saveExplorationArchive();
});

Hooks.on('createChatMessage', (message) => {
    if (!message || !message.id) return;
    if (message.flags?.core?.initiativeRoll || message.flavor?.toLowerCase().includes("initiative")) return;

    const isSecret = (message.whisper && message.whisper.length > 0) || message.blind;
    const isHolodeck = canvas.scene?.getFlag('pf2e-holodeck', 'active');
    if (isSecret && !isHolodeck) return;

    const systemFlags = message.flags?.pf2e || message.flags?.sf2e || {};
    const context = systemFlags.context || {};
    const fullText = `${message.flavor || ""} ${message.content || ""}`.toLowerCase();
    
    const isDamageTaken = context.type === "damage-taken" || fullText.includes("damage taken");
    const isAttack = context.type === "attack-roll" || context.type === "spell-attack-roll";
    const isSave = context.type === "saving-throw";
    const isSkill = context.type === "skill-check" || context.type === "perception-check";
    const isDamageRoll = message.isDamageRoll || context.type === "damage-roll";
    const hasAppliedDamage = !!systemFlags.appliedDamage;
    const hasAoEPayload = message.flags?.["aoe-easy-resolve"]?.damageTotal !== undefined;

 
    const isBaseCard = context.type === "spell-cast" || context.type === "action" || context.type === "spell-effect";
    if (isBaseCard && !hasAoEPayload) return;

    const isNarrative = /(?:takes|taking|applied|healed|restored|reduced by|mitigated|recovered)[^\d]*\d+/i.test(fullText) || /(?:unscathed|completely absorbing|guardian's taunt|wellspring surge|taunt penalty|hunted shot)/i.test(fullText);

    if (!isDamageTaken && !isAttack && !isSave && !isSkill && !isDamageRoll && !hasAppliedDamage && !isNarrative && !hasAoEPayload) return;

    window.CombatParser.parseMessage(message);

    if (isHolodeck && game.user.isGM && !isSecret && (hasAppliedDamage || isDamageTaken || isNarrative || hasAoEPayload)) message.delete();
    if (window.combatForensicsInstance && window.combatForensicsInstance.rendered) window.combatForensicsInstance.render();
});

Hooks.on('updateCombat', (combat, changed) => {
    if (!game.user.isGM) return;
    const activeLedger = window.CombatParser.ledger;
    if (combat.round > activeLedger.maxRounds) activeLedger.maxRounds = combat.round;

    if (changed.turn !== undefined || changed.round !== undefined || changed.started === false) {
        if (activeLedger.currentTurnStart && activeLedger.currentCombatant) {
            const duration = Math.round((Date.now() - activeLedger.currentTurnStart) / 1000);
            const cName = activeLedger.currentCombatant;
            if (activeLedger.actors[cName] && duration >= 0 && duration < 1200) {
                activeLedger.actors[cName].turnTimes.push(duration);
                activeLedger.masterLog.push({ isTurnSummary: true, source: cName, duration: duration, round: activeLedger.currentTurnRound || combat.round, type: "Time" });
            }
        }

        if (combat.started && combat.combatant && changed.started !== false) {
            activeLedger.currentTurnStart = Date.now();
            const c = combat.combatant;
            let rawName = c ? c.name : null;
            let canonicalName = c ? window.CombatParser.getCanonicalName(c.actor, rawName) : null;
            activeLedger.currentCombatant = canonicalName ? window.CombatParser.resolveOwner(canonicalName, c.actor) : null;
            activeLedger.currentTurnRound = combat.round;
        } else {
            activeLedger.currentTurnStart = null;
            activeLedger.currentCombatant = null;
            activeLedger.currentTurnRound = null;
        }
    }

    if (window.combatForensicsInstance && window.combatForensicsInstance.rendered) {
        window.combatForensicsInstance.selectedEncounter = "current";
        window.combatForensicsInstance.render(true);
    }
    window.CombatParser.saveLiveBackup();
});

Hooks.on('combatStart', (combat, updateData) => {
    if (game.user.isGM) {
        window.CombatParser.saveExplorationArchive(); 
        window.CombatParser.resetLedger(); 
        window.CombatParser.seedCombatants(combat);
        
        window.CombatParser.ledger.currentTurnStart = Date.now();
        const c = combat.combatant;
        let rawName = c ? c.name : null;
        let canonicalName = c ? window.CombatParser.getCanonicalName(c.actor, rawName) : null;
        window.CombatParser.ledger.currentCombatant = canonicalName ? window.CombatParser.resolveOwner(canonicalName, c?.actor) : null;
        window.CombatParser.ledger.currentTurnRound = combat.round || 1;
    }
    if (window.combatForensicsInstance && window.combatForensicsInstance.rendered) {
        window.combatForensicsInstance.selectedEncounter = "current";
        window.combatForensicsInstance.render(true);
    }
});

Hooks.on('createCombatant', (combatant, options, id) => {
    if (game.user.isGM && combatant.parent && combatant.parent.started) {
        window.CombatParser.seedCombatants(combatant.parent);
        if (window.combatForensicsInstance && window.combatForensicsInstance.rendered) window.combatForensicsInstance.render();
    }
});

Hooks.on('deleteCombat', async (combat) => { 
    if (game.user.isGM) {
        const activeLedger = window.CombatParser.ledger;
        if (activeLedger.currentTurnStart && activeLedger.currentCombatant) {
             const duration = Math.round((Date.now() - activeLedger.currentTurnStart) / 1000);
             const cName = activeLedger.currentCombatant;
             if (activeLedger.actors[cName] && duration >= 0 && duration < 1200) {
                 activeLedger.actors[cName].turnTimes.push(duration);
                 activeLedger.masterLog.push({ isTurnSummary: true, source: cName, duration: duration, round: activeLedger.currentTurnRound || combat.round, type: "Time" });
             }
        }
        await window.CombatParser.saveArchive(); 
    }
    if (window.combatForensicsInstance && window.combatForensicsInstance.rendered) {
        window.combatForensicsInstance.selectedEncounter = "exploration";
        window.combatForensicsInstance.render(true);
    }
});

Hooks.on('renderCombatTracker', async (app, html, data) => {
    const trackerElement = (app.element instanceof HTMLElement) ? app.element : (html.length ? html[0] : html);
    if (!trackerElement) return;
    await new Promise(resolve => requestAnimationFrame(resolve));
    const header = trackerElement.querySelector('.combat-tracker-header') || trackerElement.querySelector('.directory-header');
    if (!header || trackerElement.querySelector('.combat-parser-container')) return;

    const btnContainer = document.createElement('div');
    btnContainer.className = "flexrow combat-parser-container";
    btnContainer.style.cssText = "margin: 5px 8px; padding-bottom: 5px; border-bottom: 1px solid var(--color-border-dark-1); display: flex; gap: 5px;";
    
    const btn = document.createElement('button');
    btn.type = "button"; 
    btn.className = "combat-forensics-btn";
    btn.style.cssText = "flex: 1; background: rgba(0, 0, 0, 0.5); border: 1px solid #ffaa00; color: #eee; text-shadow: 0 0 5px #000; cursor: pointer;";
    btn.innerHTML = '<i class="fas fa-microscope"></i> Combat Forensics';
    
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        if (!window.combatForensicsInstance) window.combatForensicsInstance = new window.CombatForensicsApp();
        if (window.combatForensicsInstance.rendered) window.combatForensicsInstance.close();
        else window.combatForensicsInstance.render({force: true});
    });
    
    btnContainer.appendChild(btn);
    header.after(btnContainer);
});