console.log("AoE Easy Resolve | Script loaded successfully.");
const MODULE_ID = "aoe-easy-resolve";

// --- SOCKETLIB INTEGRATION ---
window.aoeSocket = null;

Hooks.once("setup", () => {
    if (game.modules.get("socketlib")?.active) {
        window.aoeSocket = socketlib.registerModule(MODULE_ID);
        window.aoeSocket.register("handleSocketPayload", handleSocketPayload);
        console.log("AoE Easy Resolve | 🔌 Socketlib integrated successfully.");
    } else {
        console.warn("AoE Easy Resolve | Socketlib is not active. Player functionality will be disabled.");
    }
});

window.aoeEasyResolveCache = null;
window.aoeEasyResolveQueue = Promise.resolve();
window.aoeEasyResolveDebounce = {};

// --- NATIVE SOCKET ROUTER ---
async function handleSocketPayload(data) {
    window.aoeEasyResolveQueue = window.aoeEasyResolveQueue.then(async () => {
        try {
            const api = game.modules.get(MODULE_ID)?.api;
            if (!api) {
                console.error("AoE Easy Resolve | ROUTER DEAD: API not attached to module object!");
                return;
            }

            if (data.action === "updateSaveRoll") {
                await api.updateTargetState(data.messageId, data.tokenId, {
                    hasRolled: true,
                    rollTotal: data.rollTotal,
                    rollFormula: data.rollFormula,
                    rollTooltip: data.rollTooltip,
                    degreeOfSuccess: data.dos,
                    unadjustedDegreeOfSuccess: data.unadjustedDos,
                    hasUsedHeroPoint: data.hasUsedHeroPoint || false,
                    hasCover: data.hasCover || false
                });

            } else if (data.action === "updateDamageRoll") {
                await api.updateDamageState(data.messageId, data);

            } else if (data.action === "createRegion") {
                const targetScene = game.scenes.get(data.sceneId);
                if (!targetScene) return;

                const newRegions = await targetScene.createEmbeddedDocuments("Region", [data.regionData]);
                const targetTemplate = targetScene.templates.get(data.templateId);
                if (targetTemplate) await targetTemplate.delete();

                await new Promise(resolve => setTimeout(resolve, 200));
                if (newRegions.length > 0) {
                    await createVisualGhost(targetScene, newRegions[0], data.userColor);
                }

            } else if (data.action === "updateRegion") {
                const targetScene = game.scenes.get(data.sceneId);
                const targetRegion = targetScene?.regions.get(data.regionId);

                if (targetRegion) {
                    await targetRegion.update({
                        [`flags.${MODULE_ID}.isAoERegion`]: true,
                        [`flags.${MODULE_ID}.originItemUuid`]: data.originItemUuid,
                        [`flags.${MODULE_ID}.persistentRules`]: data.persistentRules,
                        [`flags.${MODULE_ID}.saveDC`]: data.saveDC,
                        [`flags.${MODULE_ID}.duration`]: data.hazardDuration
                    });

                    const hasBehavior = targetRegion.behaviors?.some(b => b.name === `AoE Easy Resolve Controller`);
                    if (!hasBehavior) {
                        await targetRegion.createEmbeddedDocuments("RegionBehavior", [{
                            name: `AoE Easy Resolve Controller`,
                            type: `executeScript`,
                            system: {
                                events: data.subscribedEvents,
                                source: `console.log('AoE Easy Resolve | Region Behavior Script Firing!', event);\nif (game.modules.get('${MODULE_ID}')?.api?.handleRegionEvent) {\n  game.modules.get('${MODULE_ID}').api.handleRegionEvent(event, '${data.originItemUuid}');\n}`
                            }
                        }]);
                    }
                    await createVisualGhost(targetScene, targetRegion, data.userColor);
                }
            }
        } catch (error) { 
            console.error(`${MODULE_ID} | SOCKET ROUTER CRASHED:`, error); 
        }
    }).catch(err => { 
        console.error(`${MODULE_ID} | Queue encountered an error:`, err); 
    });
}

// --- HEAVY DIAGNOSTIC MASTER ROUTER ---
window.aoeEasyResolveRoute = function(action, payload) {
    payload.action = action;

    let cleanPayload;
    try {
        cleanPayload = JSON.parse(JSON.stringify(payload));
    } catch (err) {
        console.error("AoE Easy Resolve | Failed to sanitize payload! Hidden circular reference detected:", err);
        return;
    }

    if (game.user.isGM) {
        console.log(`AoE Easy Resolve | GM Local Route Triggered: ${action}`);
        handleSocketPayload(cleanPayload);
    } else {
        console.log(`AoE Easy Resolve | Player Emitting Clean Socket: ${action}`, cleanPayload);
        game.socket.emit(`module.${MODULE_ID}`, cleanPayload);
    }
};

// --- FOUNDRY V14 COMPATIBILITY WRAPPERS ---
const renderHBS = async (templatePath, data) => {
    if (foundry.applications?.handlebars?.renderTemplate) {
        return await foundry.applications.handlebars.renderTemplate(templatePath, data);
    }
    return await renderTemplate(templatePath, data);
};

Hooks.once("setup", () => {
    const module = game.modules.get(MODULE_ID);

    module.api = {
        interceptors: {
            preRenderCard: [],
            preApplyDamage: []
        },

        registerInterceptor: function(hookName, fn, priority = 500) {
            if (!this.interceptors[hookName]) return;
            this.interceptors[hookName].push({ fn, priority });
            this.interceptors[hookName].sort((a, b) => b.priority - a.priority);
        },

        runInterceptors: async function(hookName, payload) {
            if (!this.interceptors[hookName] || this.interceptors[hookName].length === 0) return payload;
            let currentPayload = payload;
            for (const interceptor of this.interceptors[hookName]) {
                try { 
                    currentPayload = await interceptor.fn(currentPayload); 
                } catch (err) { 
                    console.error(`AoE Easy Resolve | Interceptor crash:`, err); 
                }
            }
            return currentPayload;
        },

        updateTargetState: async function(messageId, tokenId, stateChanges) {
            console.log(`AoE Easy Resolve | Queue executing: Target Save for Token ${tokenId}`);
            const msg = game.messages.get(messageId);
            if (!msg) {
                console.error("AoE Easy Resolve | Target Update Failed: Could not find ChatMessage", messageId);
                return;
            }

            let flagUpdates = {};
            for (const [key, val] of Object.entries(stateChanges)) {
                flagUpdates[`flags.${MODULE_ID}.targets.${tokenId}.${key}`] = val;
            }

            await msg.update(flagUpdates);

            const freshMsg = game.messages.get(messageId);
            const aoeData = freshMsg.flags[MODULE_ID];
            const templatePath = `modules/${MODULE_ID}/templates/chat-card.hbs`;
            const formattedSaveType = aoeData.saveType.charAt(0).toUpperCase() + aoeData.saveType.slice(1);

            const newHtmlContent = await renderHBS(templatePath, {
                targets: formatTargetsData(aoeData.targets),
                itemName: aoeData.itemName,
                saveType: formattedSaveType,
                saveDC: aoeData.saveDC,
                damageTotal: aoeData.damageTotal,
                damageBreakdown: aoeData.damageBreakdown,
                damageFormula: aoeData.damageFormula,
                damageTooltip: aoeData.damageTooltip,
                isGM: true
            });

            await freshMsg.update({ content: newHtmlContent });
            console.log(`AoE Easy Resolve | Target Save UI Updated Successfully.`);
        },

        updateDamageState: async function(messageId, damageData) {
            console.log(`AoE Easy Resolve | Queue executing: Damage Roll Application`);
            const msg = game.messages.get(messageId);
            if (!msg) {
                console.error("AoE Easy Resolve | Damage Update Failed: Could not find ChatMessage", messageId);
                return;
            }

            let flagUpdates = {
                [`flags.${MODULE_ID}.damageJSON`]: damageData.damageJSON,
                [`flags.${MODULE_ID}.damageTotal`]: damageData.damageTotal,
                [`flags.${MODULE_ID}.damageBreakdown`]: damageData.damageBreakdown,
                [`flags.${MODULE_ID}.damageFormula`]: damageData.damageFormula,
                [`flags.${MODULE_ID}.damageTooltip`]: damageData.damageTooltip
            };

            await msg.update(flagUpdates);

            const freshMsg = game.messages.get(messageId);
            const aoeData = freshMsg.flags[MODULE_ID];
            const templatePath = `modules/${MODULE_ID}/templates/chat-card.hbs`;
            const formattedSaveType = aoeData.saveType.charAt(0).toUpperCase() + aoeData.saveType.slice(1);

            const newHtmlContent = await renderHBS(templatePath, {
                targets: formatTargetsData(aoeData.targets),
                itemName: aoeData.itemName,
                saveType: formattedSaveType,
                saveDC: aoeData.saveDC,
                damageTotal: aoeData.damageTotal,
                damageBreakdown: aoeData.damageBreakdown,
                damageFormula: aoeData.damageFormula,
                damageTooltip: aoeData.damageTooltip,
                isGM: true
            });

            await freshMsg.update({ content: newHtmlContent });
            console.log(`AoE Easy Resolve | Damage Roll UI Updated Successfully.`);
        },

        handleRegionEvent: async (regionEvent, originItemUuid) => {
            if (!game.user.isGM) return;
            const activeGM = game.users.activeGM;
            if (activeGM && game.user.id !== activeGM.id) return;

            const tokenDoc = regionEvent.data?.token || regionEvent.token;
            if (!tokenDoc || !tokenDoc.actor) return;

            const regionDoc = regionEvent.region || regionEvent.data?.region;
            if (!regionDoc) return;

            if (!window.aoeEasyResolveSpawnImmunity) window.aoeEasyResolveSpawnImmunity = {};
            const localSpawnTime = window.aoeEasyResolveSpawnImmunity[regionDoc.id];

            if (localSpawnTime && (Date.now() - localSpawnTime < 1500)) return;
            if (!localSpawnTime && (Date.now() - (regionDoc._stats?.createdTime || 0) < 5000)) return;

            let moduleContext = regionEvent.name;
            if (moduleContext === "tokenTurnStart") moduleContext = "turnStart";
            if (moduleContext === "tokenTurnEnd") moduleContext = "turnEnd";
            if (["tokenMoveIn", "tokenMoveOut", "tokenMove", "tokenMoveWithin"].includes(moduleContext)) moduleContext = "tokenMove";
            
            let debounceContext = (moduleContext === "tokenEnter" || moduleContext === "tokenMove") ? "movement" : moduleContext;
            const debounceKey = `${tokenDoc.id}-${regionDoc.id}-${debounceContext}`;

            const now = Date.now();
            const lastFire = window.aoeEasyResolveDebounce[debounceKey] || 0;
            if (now - lastFire < 2500) {
                return;
            }

            window.aoeEasyResolveDebounce[debounceKey] = now;

            if (moduleContext === "tokenExit") {
                const effectsToDelete = tokenDoc.actor.items.filter(i =>
                    (i.type === "effect" || i.type === "condition") &&
                    i.getFlag(MODULE_ID, "originRegion") === regionDoc.id
                ).map(i => i.id);

                if (effectsToDelete.length > 0) {
                    try { 
                        await tokenDoc.actor.deleteEmbeddedDocuments("Item", effectsToDelete); 
                    } catch(e) {}
                }
            }

            const originItem = await fromUuid(originItemUuid);
            if (!originItem) return;
            
            await executeEffectRules([{ actor: tokenDoc.actor, id: tokenDoc.id, document: tokenDoc }], moduleContext, "always", originItem, originItem.actor, regionDoc);
        }
    };
});

Hooks.on("preCreateChatMessage", (message, data, options, userId) => {
    if (window.aoeEasyResolveRollingDamage && message.isAuthor) {
        if (message.rolls?.length > 0 || (message.flags?.pf2e?.context?.type || "").includes("damage")) {
            window.aoeEasyResolveDamageRollData = {
                rolls: message.rolls,
                flags: message.flags
            };
            return false;
        }
    }

    if (window.aoeEasyResolveApplying?.isApplying && message.isAuthor) {
        const context = message.flags?.pf2e?.context;
        if (context && context.type === "damage-taken") {
            const tokenId = message.speaker?.token || window.aoeEasyResolveApplying.activeTokenId;
            const token = canvas.tokens.get(tokenId);

            let pf2eIWR = [];
            const fullHtml = (message.flavor || "") + " " + (message.content || "");
            let decodedHtml = fullHtml.replace(/&quot;/g, '"');

            const jsonMatches = decodedHtml.match(/\{[^{}]*(?:resist|weak|immun)[^{}]*\}/gi);
            if (jsonMatches) {
                jsonMatches.forEach(obj => {
                    let strVals = [...obj.matchAll(/"(?:category|type|damageType)"\s*:\s*"([^"]+)"/gi)].map(m => m[1]);
                    let numVal = obj.match(/"(?:adjustment|value|amount|ignored|reduced|magnitude)"\s*:\s*"?(\d+)"?/i)?.[1] || "";

                    if (strVals.length > 0) {
                        let uniqueVals = [...new Set(strVals.map(s => s.toLowerCase()))];
                        let iwrKeyword = uniqueVals.find(v => /resist|weak|immun/i.test(v)) || "";
                        let otherWords = uniqueVals.filter(v => v !== iwrKeyword);

                        if (iwrKeyword) {
                            let finalStr = iwrKeyword.charAt(0).toUpperCase() + iwrKeyword.slice(1);
                            if (otherWords.length > 0) finalStr += ": " + otherWords.join(", ");
                            if (numVal) finalStr += ` (${numVal})`;
                            pf2eIWR.push(finalStr);
                        }
                    }
                });
            }

            if (pf2eIWR.length === 0) {
                let safeHtml = decodedHtml.replace(/\[\{.*?\}\]/g, "");
                safeHtml = safeHtml.replace(/<[^>]*>/g, " ").replace(/\s\s+/g, " ");

                const textRegex = /\b(?:Resistance|Weakness|Immunity)\s*(?:\d+)?\s*(?:\([^)]+\))?/gi;
                let textMatches = safeHtml.match(textRegex);
                if (textMatches) {
                    textMatches.forEach(m => {
                        let cleanNote = m.trim();
                        cleanNote = cleanNote.charAt(0).toUpperCase() + cleanNote.slice(1);
                        if (!pf2eIWR.includes(cleanNote)) pf2eIWR.push(cleanNote);
                    });
                }
            }

            let appliedDmg = message.flags?.pf2e?.appliedDamage;
            let valTotal = 0;

            if (appliedDmg && (appliedDmg.damage !== undefined || appliedDmg.amount !== undefined)) {
                valTotal = parseInt(appliedDmg.damage || appliedDmg.amount) || 0;
            }
            if (valTotal === 0 && decodedHtml) {
                let cleanText = decodedHtml.replace(/<[^>]*>?/gm, ' ').trim();
                let textMatch = cleanText.match(/(?:damaged for|healed|takes|restored|healing|applied|recovered|loses|hit for)[^\d]*(\d+)/i) || cleanText.match(/(\d+)\s*(?:HP|Damage|DMG|Heal|Healing|applied|points)/i);
                if (textMatch) valTotal = parseInt(textMatch[1], 10);
            }
            
            let isHeal = appliedDmg ? !!appliedDmg.isHealing : false;
            let mitTotal = 0;
            let mitRegex = /(?:reduced by|resist|absorb|shield block|mitigat)[^\d]*(\d+)/ig;
            let mitMatch;
            while ((mitMatch = mitRegex.exec(decodedHtml)) !== null) mitTotal += parseInt(mitMatch[1]);

            let isKill = /(?:unconscious|dying|dead|destroyed|kill)/i.test(decodedHtml);
            if (appliedDmg && appliedDmg.updates) {
                appliedDmg.updates.forEach(u => { 
                    if (u.path?.includes("hp.value") && parseInt(u.value) <= 0) isKill = true; 
                });
            }

            window.aoeEasyResolveApplying.receipt.push({
                tokenId: tokenId,
                speaker: message.speaker,
                img: token ? token.document.texture.src : "icons/svg/mystery-man.svg",
                flavor: message.flavor,
                content: message.content,
                saveNote: window.aoeEasyResolveApplying.activeSaveNote || "",
                iwr: [...new Set(pf2eIWR)],
                forensics: { valueTotal: valTotal, isHealing: isHeal, mitigatedTotal: mitTotal, isKill: isKill }
            });
            return false;
        }
    }
});

// --- HELPER FUNCTIONS ---
function compileHeightenedDamage(item, baseDmg, scaleDmg, scaleMode, castLevel) {
    let formula = baseDmg || "0";
    if (!scaleDmg || scaleMode === "none" || !item || !item.actor) return formula;

    const actor = item.actor;
    let multiplier = 0;

    if (scaleMode === "spellRank") {
        const baseRank = item.system?.level?.value || 1;
        const actualRank = parseInt(castLevel) || baseRank;
        multiplier = Math.max(0, actualRank - baseRank);
    } else if (scaleMode === "actorLevel") {
        multiplier = parseInt(actor.level ?? actor.system?.details?.level?.value ?? 0) || 0;
    } else if (scaleMode === "cantrip") {
        const lvl = parseInt(actor.level ?? actor.system?.details?.level?.value ?? 0) || 1;
        multiplier = Math.max(0, Math.ceil(lvl / 2) - 1);
    }

    if (multiplier > 0) {
        formula = `${formula} + (${multiplier} * (${scaleDmg}))`;
    }
    return formula;
}

function getUnadjustedDos(total, dc, d20) {
    if (dc === undefined || dc === null) return undefined;
    let dos = 1;
    if (total >= dc + 10) dos = 3;
    else if (total <= dc - 10) dos = 0;
    else if (total >= dc) dos = 2;

    if (d20 === 20) dos = Math.min(dos + 1, 3);
    else if (d20 === 1) dos = Math.max(dos - 1, 0);

    return dos;
}

function buildRollTooltip(actor, saveType, rollResult, d20, modifier) {
    const modSign = modifier >= 0 ? "+" : "-";
    let fallback = `(${d20} ${modSign} ${Math.abs(modifier)})`;
    try {
        let rawMods = actor?.saves?.[saveType]?.modifiers || [];

        if (Array.isArray(rawMods) && rawMods.length > 0) {
            const activeMods = rawMods
                .filter(m => m.enabled && !m.ignored)
                .map(m => `${m.label} ${m.modifier >= 0 ? '+' : ''}${m.modifier}`);

            const baseSum = rawMods.filter(m => m.enabled && !m.ignored).reduce((acc, m) => acc + m.modifier, 0);
            if (baseSum !== modifier) {
                const diff = modifier - baseSum;
                activeMods.push(`Situational ${diff >= 0 ? '+' : ''}${diff}`);
            }

            if (activeMods.length > 0) {
                return `d20: ${d20} | ${activeMods.join(', ')}`;
            }
        }
    } catch (e) {
        console.warn("AoE Easy Resolve | Failed to extract native modifiers for tooltip.", e);
    }
    return fallback;
}

function getSystemSaveDC(item, dcType, customDC) {
    if (!item || !item.actor) return parseInt(customDC) || null;
    const actor = item.actor;

    if (!dcType || dcType === "custom") return parseInt(customDC) || null;

    let maxClassDC = 0;
    let maxSpellDC = 0;

    if (actor.system?.attributes?.classDC?.value) {
        let val = parseInt(actor.system.attributes.classDC.value) || 0;
        if (val > maxClassDC) maxClassDC = val;
    }
    if (actor.classDC?.dc?.value) {
        let val = parseInt(actor.classDC.dc.value) || 0;
        if (val > maxClassDC) maxClassDC = val;
    }
    if (actor.classDCs) {
        for (let key in actor.classDCs) {
            let val = parseInt(actor.classDCs[key]?.dc?.value) || 0;
            if (val > maxClassDC) maxClassDC = val;
        }
    }

    if (actor.spellcasting) {
        let scEntries = [];
        if (Array.isArray(actor.spellcasting)) scEntries = actor.spellcasting;
        else if (actor.spellcasting.contents) scEntries = actor.spellcasting.contents;
        else if (typeof actor.spellcasting.values === 'function') scEntries = Array.from(actor.spellcasting.values());
        else scEntries = Object.values(actor.spellcasting);

        scEntries.forEach(sc => {
            let val = parseInt(sc.statistic?.dc?.value || sc.system?.spelldc?.dc) || 0;
            if (val > maxSpellDC) maxSpellDC = val;
        });
    }

    let highestDC = maxClassDC > maxSpellDC ? maxClassDC : maxSpellDC;
    const fallbackLevel = 10 + parseInt(actor.level ?? actor.system?.details?.level?.value ?? 0);

    if (dcType === "spell") return maxSpellDC > 0 ? maxSpellDC : fallbackLevel;
    if (dcType === "class") return maxClassDC > 0 ? maxClassDC : fallbackLevel;
    if (dcType === "highest") return highestDC > 0 ? highestDC : fallbackLevel;

    return parseInt(customDC) || null;
}

function formatTargetsData(targetsObj) {
    const dosMap = {
        "criticalSuccess": { label: "Crit Success", color: "#008000" },
        "success": { label: "Success", color: "#0000ff" },
        "failure": { label: "Failure", color: "#ff8c00" },
        "criticalFailure": { label: "Crit Failure", color: "#ff0000" }
    };

    return Object.values(targetsObj).map(t => {
        let displayData = { ...t };
        if (t.degreeOfSuccess) {
            displayData.dosColor = dosMap[t.degreeOfSuccess]?.color || "#000000";
            displayData.dosLabel = dosMap[t.degreeOfSuccess]?.label || t.degreeOfSuccess;
        }
        if (t.unadjustedDegreeOfSuccess) {
            displayData.unadjustedDosLabel = dosMap[t.unadjustedDegreeOfSuccess]?.label || t.unadjustedDegreeOfSuccess;
            displayData.showUnadjusted = t.degreeOfSuccess !== t.unadjustedDegreeOfSuccess;
        }
        return displayData;
    }).sort((a, b) => a.name.localeCompare(b.name));
}

async function generateReactiveSaveCard(tokenDoc, originItem, regionDoc) {
    const flags = originItem.flags?.[MODULE_ID] || {};
    const regionFlags = regionDoc?.flags?.[MODULE_ID] || {};

    let saveType = flags.useOverride ? flags.saveType : originItem.system?.defense?.save?.statistic;
    if (!saveType) saveType = "reflex";

    let saveDC = regionFlags.saveDC || null;
    if (!saveDC) {
        saveDC = flags.useOverride 
            ? getSystemSaveDC(originItem, flags.dcType, flags.saveDC) 
            : (originItem.system?.defense?.save?.dc?.value || getSystemSaveDC(originItem, "highest"));
    }

    const isBasicSave = originItem.system?.defense?.save?.basic ?? true;

    const targetsData = {};
    targetsData[tokenDoc.id] = {
        id: tokenDoc.id,
        name: tokenDoc.name,
        img: tokenDoc.texture?.src || tokenDoc.document?.texture?.src || "icons/svg/mystery-man.svg",
        hasRolled: false, 
        rollTotal: null, 
        degreeOfSuccess: null,
        isHealing: false, 
        isImmune: false, 
        hasApplied: false
    };

    const templatePath = `modules/${MODULE_ID}/templates/chat-card.hbs`;
    const formattedSaveType = saveType.charAt(0).toUpperCase() + saveType.slice(1);
    const hazardName = originItem.name + " (Reaction)";

    const htmlContent = await renderHBS(templatePath, {
        targets: formatTargetsData(targetsData), 
        itemName: hazardName,
        saveType: formattedSaveType, 
        saveDC: saveDC,
        damageTotal: null, 
        damageBreakdown: null, 
        damageFormula: null, 
        damageTooltip: null, 
        isGM: game.user.isGM
    });

    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker(), 
        content: htmlContent,
        flags: {
            [MODULE_ID]: {
                itemUuid: originItem.uuid, 
                itemName: hazardName,
                saveType: saveType, 
                saveDC: saveDC, 
                isBasicSave: isBasicSave,
                targets: targetsData, 
                hazardDamage: null,
                isReactive: true, 
                castLevel: originItem?.system?.level?.value || 1
            }
        }
    });
}

// --- CORE RULES ENGINE EXECUTOR ---
async function executeEffectRules(targetsArray, contextStr, outcomeStr, originItem, messageActor, regionDoc = null) {
    if (!originItem) return;
    const flags = originItem.flags?.[MODULE_ID] || {};
    const rules = Array.isArray(flags.rules) ? flags.rules : Object.values(flags.rules || {});
    if (rules.length === 0) return;

    for (let rule of rules) {
        let isMatch = (rule.context === contextStr);

        if ((contextStr === "tokenEnter" || contextStr === "tokenMove") && 
            (rule.context === "tokenEnter" || rule.context === "tokenMove")) {
            isMatch = true;
        }

        if (!isMatch) continue;

        const isRegionEvent = ["tokenEnter", "tokenExit", "tokenMove", "turnStart", "turnEnd"].includes(contextStr);
        if (!isRegionEvent) {
            if (rule.outcome !== "always" && rule.outcome !== outcomeStr) {
                let isComboMatch = false;
                if (rule.outcome === "failOrWorse" && (outcomeStr === "failure" || outcomeStr === "criticalFailure")) isComboMatch = true;
                if (rule.outcome === "successOrBetter" && (outcomeStr === "success" || outcomeStr === "criticalSuccess")) isComboMatch = true;

                if (!isComboMatch) continue;
            }
        }
        
        let validTargets = targetsArray;

        if (rule.alliance && rule.alliance !== "all") {
            const casterAlliance = messageActor?.alliance || originItem?.actor?.alliance || "party";
            validTargets = validTargets.filter(t => {
                const targetAlliance = t.actor?.alliance;
                if (!targetAlliance) return true;
                if (rule.alliance === "enemy") return targetAlliance !== casterAlliance;
                if (rule.alliance === "ally") return targetAlliance === casterAlliance;
                return true;
            });
        }

        if (rule.trait && rule.trait.trim() !== "") {
            const reqTraits = rule.trait.split(",").map(t => t.trim().toLowerCase()).filter(t => t !== "");
            validTargets = validTargets.filter(t => {
                const actorTraits = t.actor?.system?.traits?.value || [];
                return actorTraits.some(tr => reqTraits.includes(tr.toLowerCase()));
            });
        }

        if (validTargets.length === 0) continue;

        if (rule.promptSave) {
            for (let t of validTargets) {
                const doc = t.document || t;
                await generateReactiveSaveCard(doc, originItem, regionDoc);
            }
            continue;
        }

        if (rule.conditionUuid) {
            let cleanUuid = rule.conditionUuid.trim();
            const match = cleanUuid.match(/@UUID\[(.*?)\]/);
            if (match) cleanUuid = match[1];
            if (cleanUuid.includes("{")) cleanUuid = cleanUuid.split("{")[0];

            try {
                let conditionItem;
                if (!cleanUuid.includes(".")) {
                    conditionItem = game.pf2e.ConditionManager.getCondition(cleanUuid.toLowerCase());
                } else {
                    conditionItem = await fromUuid(cleanUuid);
                }

                if (conditionItem) {
                    let itemData;
                    const valueInt = parseInt(rule.conditionValue);
                    const durationInt = parseInt(rule.conditionDuration);
                    const hasDuration = !isNaN(durationInt) && durationInt > 0;

                    if (hasDuration) {
                        const cUuid = conditionItem.sourceId || conditionItem.flags?.core?.sourceId || conditionItem.uuid;

                        let grantRule = {
                            key: "GrantItem",
                            uuid: cUuid,
                            allowDuplicate: false,
                            replaceSelf: false
                        };

                        if (!isNaN(valueInt) && conditionItem.system?.value?.isValued) {
                            grantRule.alterations = [{ property: "badge-value", mode: "upgrade", value: valueInt }];
                        }
                        itemData = {
                            name: `Effect: ${originItem?.name || "Hazard"} (${conditionItem.name})`,
                            type: "effect",
                            img: conditionItem.img || "systems/pf2e/icons/default-icons/effect.svg",
                            system: {
                                level: { value: originItem?.system?.level?.value || 1 },
                                duration: { value: durationInt, unit: "rounds", expiry: "turn-end", sustained: false },
                                rules: [grantRule]
                            }
                        };
                    } else {
                        itemData = conditionItem.toObject();
                        delete itemData._id;

                        if (!isNaN(valueInt)) {
                            itemData.system.value = itemData.system.value || {};
                            itemData.system.value.value = valueInt;
                        }
                    }

                    if (regionDoc && rule.removeOnExit) {
                        itemData.flags = itemData.flags || {};
                        itemData.flags[MODULE_ID] = itemData.flags[MODULE_ID] || {};
                        itemData.flags[MODULE_ID].originRegion = regionDoc.id;
                    }

                    for (let t of validTargets) {
                        const actor = t.actor || t.document?.actor;
                        const tokenId = t.id || t.document?.id;
                        const tokenName = t.name || t.document?.name || "Target";
                        
                        if (!actor) continue;

                        const createdItems = await actor.createEmbeddedDocuments("Item", [itemData]);

                        if (regionDoc && rule.removeOnExit) {
                            for (let c of createdItems) {
                                try { await c.setFlag(MODULE_ID, "originRegion", regionDoc.id); } catch(err) {}
                            }
                        }

                        const effectBadge = !isNaN(valueInt) ? ` ${valueInt}` : "";
                        const effectRounds = hasDuration ? ` (${durationInt} Rnds)` : "";
                        const effectMsg = `<span style="color: #9b59b6; font-weight: bold;">+ ${conditionItem.name}${effectBadge}${effectRounds}</span>`;
                        
                        const visualChip = `<span style="background: rgba(155, 89, 182, 0.15); color: #d2b4de; padding: 2px 6px; border-radius: 4px; font-size: 0.8em; border: 1px solid rgba(155, 89, 182, 0.4); white-space: nowrap; line-height: 1; box-shadow: 0 1px 2px rgba(0,0,0,0.2);">+ ${conditionItem.name}${effectBadge}</span>`;

                        if (window.aoeEasyResolveApplying?.receipt) {
                            let existingEntry = window.aoeEasyResolveApplying.receipt.find(r => r.tokenId === tokenId);
                            if (existingEntry) {
                                existingEntry.saveNote = existingEntry.saveNote ? `${existingEntry.saveNote}<br>${effectMsg}` : effectMsg;
                                existingEntry.appliedConditions = existingEntry.appliedConditions || [];
                                existingEntry.appliedConditions.push(visualChip);
                            } else {
                                window.aoeEasyResolveApplying.receipt.push({
                                    tokenId: tokenId, speaker: { alias: tokenName }, img: t.document?.texture?.src || "icons/svg/mystery-man.svg",
                                    content: `<span style="font-weight: bold; color: #888;">Effect Applied</span>`, 
                                    saveNote: effectMsg,
                                    forensics: { valueTotal: 0, isHealing: false, mitigatedTotal: 0, isKill: false },
                                    appliedConditions: [visualChip]
                                });
                            }
                        } else {
                            console.log(`AoE Easy Resolve | Applied ${conditionItem.name} to ${tokenName}.`);
                        }
                    }
                } else {
                    console.warn(`AoE Easy Resolve | Could not locate condition: ${cleanUuid}`);
                }
            } catch(e) { 
                console.error("AoE Easy Resolve | Error applying condition", e); 
            }
        }

        if (rule.damageFormula) {
            try {
                const rollData = originItem ? originItem.getRollData() : {};
                const parsedFormula = Roll.replaceFormulaData(rule.damageFormula, rollData);
                const formula = rule.damageType ? `(${parsedFormula})[${rule.damageType}]` : parsedFormula;
                const pf2eDamageClass = CONFIG.Dice.rolls.find(r => r.name === "DamageRoll") || Roll;

                const dRoll = await new pf2eDamageClass(formula, rollData).evaluate();

                const outcomeLabels = { criticalSuccess: "Critical", success: "Hit/Success", failure: "Miss/Failure", criticalFailure: "Critical Miss", always: "Persistent" };
                const traitNotice = rule.trait ? ` (vs ${rule.trait})` : "";

                const speakerActor = messageActor || game.user.character;
                const speakerParams = speakerActor ? { actor: speakerActor } : {};

                await dRoll.toMessage({
                    speaker: ChatMessage.getSpeaker(speakerParams),
                    flavor: `<strong>${outcomeLabels[outcomeStr] || "Effect"} Damage!${traitNotice}</strong><br><span style="font-size: 0.9em; color: #555;">Triggered by: ${originItem.name}</span>`
                });
            } catch(e) { 
                console.error("AoE Easy Resolve | Error rolling bonus damage", e); 
            }
        }
    }
}

Hooks.once("init", async function () {
    console.log(`${MODULE_ID} | Initializing module`);

    // --- HEAVY DIAGNOSTIC SOCKET LISTENER ---
    game.socket.on(`module.${MODULE_ID}`, (data) => {
        console.log(`AoE Easy Resolve | 📡 SOCKET RECEIVED: ${data.action}`, data);

        if (!game.user.isGM) {
            console.log(`AoE Easy Resolve | 🛑 Socket Rejected: I am not a GM.`);
            return;
        }

        const designatedGMId = game.users.activeGM?.id || game.users.find(u => u.isGM && u.active)?.id;
        if (designatedGMId && game.user.id !== designatedGMId) {
            console.log(`AoE Easy Resolve | 🛑 Socket Rejected: I am a GM, but not the primary Active GM.`);
            return;
        }

        console.log(`AoE Easy Resolve | ✅ Socket Accepted! Routing to queue...`);
        handleSocketPayload(data);
    });

    const style = document.createElement("style");
    style.innerHTML = `
        @keyframes erPulsePlayer {
            0% { box-shadow: 0 0 0 0 rgba(52, 152, 219, 0.7); border-color: #3498db; }
            70% { box-shadow: 0 0 0 6px rgba(52, 152, 219, 0); border-color: #2980b9; }
            100% { box-shadow: 0 0 0 0 rgba(52, 152, 219, 0); border-color: #3498db; }
        }
        @keyframes erPulseGM {
            0% { box-shadow: 0 0 0 0 rgba(231, 76, 60, 0.7); border-color: #e74c3c; }
            70% { box-shadow: 0 0 0 6px rgba(231, 76, 60, 0); border-color: #c0392b; }
            100% { box-shadow: 0 0 0 0 rgba(231, 76, 60, 0); border-color: #e74c3c; }
        }
        @keyframes erPulseApply {
            0% { box-shadow: 0 0 0 0 rgba(46, 204, 113, 0.7); border-color: #2ecc71; }
            70% { box-shadow: 0 0 0 6px rgba(46, 204, 113, 0); border-color: #27ae60; }
            100% { box-shadow: 0 0 0 0 rgba(46, 204, 113, 0); border-color: #2ecc71; }
        }
        .er-pulse-player { animation: erPulsePlayer 2s infinite; font-weight: bold; color: #fff; background: rgba(52, 152, 219, 0.15); }
        .er-pulse-gm { animation: erPulseGM 2s infinite; font-weight: bold; color: #fff; background: rgba(231, 76, 60, 0.15); }
        .er-pulse-apply { animation: erPulseApply 2s infinite; font-weight: bold; color: #fff; background: rgba(46, 204, 113, 0.15); }
    `;
    document.head.appendChild(style);

    game.settings.register(MODULE_ID, "promptUntypedTemplates", {
        name: "Prompt Saves for Manual Templates",
        hint: "When the GM draws a measured template from the sidebar, prompt them to create a custom AoE save card.",
        scope: "world",
        config: true,
        type: Boolean,
        default: false
    });
    loadTemplates([`modules/${MODULE_ID}/templates/chat-card.hbs`, `modules/${MODULE_ID}/templates/item-config.hbs`]);
});

// --- APPLICATION V2 CONFIGURATOR ---
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications?.api || {};

class AoEItemConfigApp extends HandlebarsApplicationMixin(ApplicationV2) {
    static instances = new Map();

    constructor(item) {
        super({ id: `aoe-config-${item.id}` });
        this.item = item;
        AoEItemConfigApp.instances.set(item.uuid, this);
    }

    static DEFAULT_OPTIONS = {
        tag: "form",
        window: {
            title: "AoE Easy Resolve Configuration",
            icon: "fas fa-bullseye",
            resizable: true,
            controls: [
                { icon: "fas fa-magic", label: "Toggle Wizard Mode", action: "toggleWizard" }
            ]
        },
        position: { width: 650, height: 700 },
        form: { handler: function(e, f, d) { return this._onSubmit(e, f, d); }, submitOnChange: false, closeOnSubmit: true },
        actions: {
            addRule: function(e, t) { this._onAddRule(e, t); },
            deleteRule: function(e, t) { this._onDeleteRule(e, t); },
            toggleWizard: function(e, t) { this._onToggleWizard(e, t); },
            addDamagePart: function(e, t) { this._onAddDamagePart(e, t); },
            addWizardEffect: function(e, t) { this._onAddWizardEffect(e, t); },
            deleteWizardEffect: function(e, t) { this._onDeleteWizardEffect(e, t); },
            deleteDamagePart: function(e, t) { this._onDeleteDamagePart(e, t); }
        }
    };

    static PARTS = {
        form: { template: `modules/${MODULE_ID}/templates/item-config.hbs` }
    };

    static async show(item) {
        let app = this.instances.get(item.uuid);
        if (app) return app.render(true, { focus: true });
        app = new this(item);
        return app.render(true);
    }

    async _prepareContext(options) {
        const flags = this.item.flags[MODULE_ID] || {};

        const pf2eDamageTypes = CONFIG.PF2E?.damageTypes || {};
        const damageTypeOptions = Object.entries(pf2eDamageTypes).map(([key, name]) => {
            return { key: key, label: game.i18n.localize(name), selected: flags.customDamageType === key ? "selected" : "" };
        });
        damageTypeOptions.sort((a, b) => a.label.localeCompare(b.label));
        damageTypeOptions.unshift({ key: "", label: "None / Untyped", selected: !flags.customDamageType ? "selected" : "" });
        
        let rawDamageParts = Array.isArray(flags.damageParts) ? flags.damageParts : Object.values(flags.damageParts || {});
        if (rawDamageParts.length === 0) rawDamageParts = [{ dice: "", die: "d6", type: "" }];

        const mappedDamageParts = rawDamageParts.map((p, i) => ({
            index: i,
            dice: p.dice || "",
            dieOptions: ["d4", "d6", "d8", "d10", "d12"].map(d => ({ value: d, selected: p.die === d ? "selected" : "" })),
            typeOptions: damageTypeOptions.map(dto => ({ ...dto, selected: p.type === dto.key ? "selected" : "" }))
        }));

        const rawRules = Array.isArray(flags.rules) ? flags.rules : Object.values(flags.rules || {});
        
        const processedRules = rawRules
            .map((r, i) => {
                if (r.isWizardRule) return null;
                return {
                    index: i,
                    isAttack: r.context === "attack" || !r.context,
                    isSave: r.context === "save",
                    isReactiveSave: r.context === "reactiveSave",
                    isTokenEnter: r.context === "tokenEnter",
                    isTokenExit: r.context === "tokenExit",
                    isTokenMove: r.context === "tokenMove",
                    isTurnStart: r.context === "turnStart",
                    isTurnEnd: r.context === "turnEnd",
                    isAlways: r.outcome === "always",
                    isCS: r.outcome === "criticalSuccess",
                    isSuccessOrBetter: r.outcome === "successOrBetter",
                    isFailOrWorse: r.outcome === "failOrWorse",
                    isS: r.outcome === "success",
                    isF: r.outcome === "failure",
                    isCF: r.outcome === "criticalFailure",
                    promptSave: r.promptSave || false,
                    trait: r.trait || "",
                    conditionUuid: r.conditionUuid || "",
                    damageFormula: r.damageFormula || "",
                    damageTypeOptions: damageTypeOptions.map(dto => ({ ...dto, selected: r.damageType === dto.key ? "selected" : "" })),
                    isAllianceAll: !r.alliance || r.alliance === "all",
                    isAllianceEnemy: r.alliance === "enemy",
                    isAllianceAlly: r.alliance === "ally",
                    removeOnExit: r.removeOnExit || false 
                };
            })
            .filter(r => r !== null);

        const commonConditions = ["Blinded", "Clumsy", "Dazzled", "Deafened", "Enfeebled", "Fascinated", "Fleeing", "Frightened", "Grabbed", "Immobilized", "Off-Guard", "Paralyzed", "Prone", "Restrained", "Sickened", "Slowed", "Stunned"];
        
        let rawWizardEffects = Array.isArray(flags.wizardEffects) ? flags.wizardEffects : Object.values(flags.wizardEffects || {});
        if (rawWizardEffects.length === 0) rawWizardEffects = [{ slug: "frightened", value: 1, duration: "", outcome: "failure" }];

        const mappedWizardEffects = rawWizardEffects.map((e, i) => ({
            index: i,
            value: e.value || "",
            duration: e.duration || "",
            selCF: e.outcome === "criticalFailure" ? "selected" : "",
            selFailOrWorse: e.outcome === "failOrWorse" ? "selected" : "",
            selF: e.outcome === "failure" ? "selected" : "",
            selS: e.outcome === "success" ? "selected" : "",
            selSuccessOrBetter: e.outcome === "successOrBetter" ? "selected" : "",
            selCS: e.outcome === "criticalSuccess" ? "selected" : "",
            selAlways: e.outcome === "always" ? "selected" : "",
            conditionOptions: commonConditions.map(c => ({ key: c.toLowerCase(), label: c, selected: e.slug === c.toLowerCase() ? "selected" : "" }))
        }));

        return {
            isWizard: flags.wizardMode ?? true, 
            isBasicSave: flags.isBasicSave ?? true, 
            mappedWizardEffects: mappedWizardEffects,
            useWizardEffects: flags.useWizardEffects || false,
            mappedDamageParts: mappedDamageParts,
            ignoreAoE: flags.ignoreAoE || false,
            enableMultiTarget: flags.enableMultiTarget || false,
            isAreaDamage: flags.isAreaDamage || true,
            useOverride: flags.useOverride || false,
            provideTemplate: flags.provideTemplate || false,
            isCone: flags.templateType === "cone" || !flags.templateType,
            isCircle: flags.templateType === "circle",
            isRay: flags.templateType === "ray",
            isRect: flags.templateType === "rect",
            templateDistance: flags.templateDistance || 15,
            hazardDuration: flags.hazardDuration || "",
            terrainEffect: flags.terrainEffect || "none",
            terrainNone: !flags.terrainEffect || flags.terrainEffect === "none",
            terrainDifficult: flags.terrainEffect === "difficult",
            terrainGreater: flags.terrainEffect === "greater",
            isFort: flags.saveType === "fortitude",
            isReflex: flags.saveType === "reflex" || !flags.saveType,
            isWill: flags.saveType === "will",
            saveDC: flags.saveDC || "",
            dcType: flags.dcType || "custom",
            isCustomDC: !flags.dcType || flags.dcType === "custom",
            isClassDC: flags.dcType === "class",
            isSpellDC: flags.dcType === "spell",
            isHighestDC: flags.dcType === "highest",
            useCustomDamage: flags.useCustomDamage || false,
            baseDamage: flags.baseDamage || flags.customDamage || "", 
            scaleDamage: flags.scaleDamage || "",
            scaleMode: flags.scaleMode || "none",
            scaleNone: !flags.scaleMode || flags.scaleMode === "none",
            scaleSpellRank: flags.scaleMode === "spellRank",
            scaleActorLevel: flags.scaleMode === "actorLevel",
            scaleCantrip: flags.scaleMode === "cantrip",
            customDamage: flags.customDamage || "",
            tacticalDrawing: flags.tacticalDrawing || false,
            tacticalBlocks: flags.tacticalBlocks || "",
            damageTypeOptions: damageTypeOptions,
            multipliers: flags.multipliers || { criticalSuccess: "0", success: "0.5", failure: "1", criticalFailure: "2" },
            processedRules: processedRules,
            enemyBaseStandard: !flags.enemyBaseEffect || flags.enemyBaseEffect === 'standard',
            enemyBaseHeal: flags.enemyBaseEffect === 'heal',
            enemyBaseImmune: flags.enemyBaseEffect === 'immune',
            allyBaseStandard: !flags.allyBaseEffect || flags.allyBaseEffect === 'standard',
            allyBaseHeal: flags.allyBaseEffect === 'heal',
            allyBaseImmune: flags.allyBaseEffect === 'immune'
        };
    }

    _onRender(context, options) {
        super._onRender(context, options);
        const html = this.element;
        
        // --- ADVANCED TAB ROUTER ---
        html.querySelectorAll(".aoe-app-nav a.item").forEach(t => {
            t.addEventListener("click", (ev) => {
                const tabName = ev.currentTarget.dataset.tab;
                html.querySelectorAll(".aoe-app-nav a.item").forEach(i => i.classList.remove("active"));
                html.querySelectorAll(".tab-content .tab").forEach(c => c.classList.remove("active"));
                ev.currentTarget.classList.add("active");
                html.querySelector(`.tab-content .tab[data-tab='${tabName}']`).classList.add("active");
            });
        });
        html.querySelector(".aoe-app-nav a.item")?.click();

        // --- WIZARD LOGIC ---
        if (context.isWizard) {
            this._wizardStep = this._wizardStep || 1;
            const totalSteps = 6;

            const updateWizardUI = () => {
                html.querySelectorAll(".wizard-step").forEach(el => {
                    el.style.display = parseInt(el.dataset.step) === this._wizardStep ? "block" : "none";
                });
                
                html.querySelector(".wizard-prev").style.display = this._wizardStep > 1 ? "inline-block" : "none";
                html.querySelector(".wizard-next").style.display = this._wizardStep < totalSteps ? "inline-block" : "none";
                html.querySelector(".wizard-save").style.display = this._wizardStep === totalSteps ? "inline-block" : "none";

                const progress = ((this._wizardStep - 1) / (totalSteps - 1)) * 100;
                html.querySelector(".wizard-progress-bar").style.width = `${progress}%`;
            };

            html.querySelector(".wizard-next").addEventListener("click", () => {
                if (this._wizardStep < totalSteps) this._wizardStep++;
                updateWizardUI();
            });

            html.querySelector(".wizard-prev").addEventListener("click", () => {
                if (this._wizardStep > 1) this._wizardStep--;
                updateWizardUI();
            });

            html.querySelectorAll("input[name='wizardShape']").forEach(radio => {
                radio.addEventListener("change", (ev) => {
                    const normal = html.querySelector(".wizard-normal-settings");
                    const tactical = html.querySelector(".wizard-tactical-settings");
                    if (normal) normal.style.display = ev.target.value === "normal" ? "block" : "none";
                    if (tactical) tactical.style.display = ev.target.value === "tactical" ? "block" : "none";
                });
            });

            html.querySelectorAll("input[name='wizardSave']").forEach(radio => {
                radio.addEventListener("change", (ev) => {
                    html.querySelector(".wizard-save-settings").style.display = ev.target.value === "yes" ? "block" : "none";
                });
            });

            html.querySelectorAll("input[name='wizardPersist']").forEach(radio => {
                radio.addEventListener("change", (ev) => {
                    html.querySelector(".wizard-persist-settings").style.display = ev.target.value === "yes" ? "block" : "none";
                });
            });

            html.querySelectorAll("input[name='flags.aoe-easy-resolve.useCustomDamage']").forEach(checkbox => {
                checkbox.addEventListener("change", (ev) => {
                    const container = html.querySelector(".wizard-damage-settings");
                    if (container) container.style.display = ev.target.checked ? "block" : "none";
                    
                    html.querySelectorAll("input[name='flags.aoe-easy-resolve.useCustomDamage']").forEach(cb => {
                        cb.checked = ev.target.checked;
                    });
                });
            });

            html.querySelectorAll("input[name='flags.aoe-easy-resolve.useWizardEffects']").forEach(checkbox => {
                checkbox.addEventListener("change", (ev) => {
                    const container = html.querySelector(".wizard-effects-settings");
                    if (container) container.style.display = ev.target.checked ? "block" : "none";
                });
            });

            updateWizardUI(); 
        }
    }

    async _onSubmit(event, form, formData) {
        const expanded = foundry.utils.expandObject(formData.object);
        let aoeFlags = expanded.flags?.[MODULE_ID] || {};
        
        const activeTab = this.element.querySelector('.aoe-app-nav a.item.active')?.dataset?.tab || "wizard";
        
        if (activeTab === "wizard") {
            aoeFlags.provideTemplate = expanded.wizardShape === "normal";
            aoeFlags.enableMultiTarget = expanded.wizardShape === "multi";
            aoeFlags.tacticalDrawing = expanded.wizardShape === "tactical";
            aoeFlags.useOverride = expanded.wizardSave === "yes";
            if (expanded.wizardPersist === "no") aoeFlags.hazardDuration = "";
            
            aoeFlags.useWizardEffects = !!aoeFlags.useWizardEffects;
            aoeFlags.wizardEffects = aoeFlags.wizardEffects ? Object.values(aoeFlags.wizardEffects) : [];
            
        } else {
            aoeFlags.provideTemplate = !!aoeFlags.provideTemplate;
            aoeFlags.enableMultiTarget = !!aoeFlags.enableMultiTarget;
            aoeFlags.tacticalDrawing = !!aoeFlags.tacticalDrawing;
            aoeFlags.useOverride = !!aoeFlags.useOverride;
            
            aoeFlags.useWizardEffects = !!aoeFlags.useWizardEffects;
            aoeFlags.wizardEffects = aoeFlags.wizardEffects ? Object.values(aoeFlags.wizardEffects) : [];
        }

        let manualRules = [];
        if (aoeFlags.rules) {
            manualRules = Object.values(aoeFlags.rules).map(r => ({
                ...r,
                removeOnExit: !!r.removeOnExit,
                promptSave: !!r.promptSave,
                isWizardRule: false 
            }));
        }

        let generatedRules = [];
        if (aoeFlags.useWizardEffects && aoeFlags.wizardEffects.length > 0) {
            generatedRules = aoeFlags.wizardEffects.filter(e => e.slug).map(e => ({
                context: "save",
                outcome: e.outcome,
                conditionUuid: e.slug,
                conditionValue: e.value,
                conditionDuration: e.duration,
                isWizardRule: true,
                alliance: "all",
                promptSave: false
            }));
        }

        aoeFlags.rules = [...manualRules, ...generatedRules];

        aoeFlags.useCustomDamage = !!aoeFlags.useCustomDamage;
        aoeFlags.isAreaDamage = !!aoeFlags.isAreaDamage;
        aoeFlags.ignoreAoE = !!aoeFlags.ignoreAoE;
        aoeFlags.isBasicSave = !!aoeFlags.isBasicSave;
        
        if (aoeFlags.damageParts && Object.keys(aoeFlags.damageParts).length > 0) {
            aoeFlags.damageParts = Object.values(aoeFlags.damageParts);
            let compiledStr = aoeFlags.damageParts
                .filter(p => p.dice && p.die)
                .map(p => `${p.dice}${p.die}${p.type ? `[${p.type}]` : ""}`)
                .join(" + ");
            aoeFlags.baseDamage = compiledStr;
        } else {
            aoeFlags.baseDamage = "";
        }
        
        await this.item.update({ [`flags.${MODULE_ID}`]: aoeFlags });
        ui.notifications.success("AoE Easy Resolve | Configuration Saved.");
    }

    async _onAddRule(event, target) {
        let manualRules = [];
        try {
            const fd = new FormDataExtended(this.element).object;
            const expanded = foundry.utils.expandObject(fd);
            if (expanded.flags?.[MODULE_ID]?.rules) {
                manualRules = Object.values(expanded.flags[MODULE_ID].rules);
            }
        } catch(e) {}
        
        manualRules.push({ context: "attack", outcome: "criticalSuccess", promptSave: false, trait: "", conditionUuid: "", damageFormula: "", damageType: "", alliance: "all", removeOnExit: false, isWizardRule: false }); 
        
        const currentRules = Array.isArray(this.item.flags[MODULE_ID]?.rules) ? this.item.flags[MODULE_ID].rules : Object.values(this.item.flags[MODULE_ID]?.rules || {});
        const oldWizardRules = currentRules.filter(r => r.isWizardRule);
        
        await this.item.update({ [`flags.${MODULE_ID}.rules`]: [...manualRules, ...oldWizardRules] });
        this.render({force: true});
    }

    async _onDeleteRule(event, target) {
        const deleteIndex = target.dataset.index;
        let manualRules = [];
        try {
            const fd = new FormDataExtended(this.element).object;
            const expanded = foundry.utils.expandObject(fd);
            if (expanded.flags?.[MODULE_ID]?.rules) {
                const rulesObj = expanded.flags[MODULE_ID].rules;
                delete rulesObj[deleteIndex]; // Delete the exact HTML index requested
                manualRules = Object.values(rulesObj);
            }
        } catch(e) {}
        
        const currentRules = Array.isArray(this.item.flags[MODULE_ID]?.rules) ? this.item.flags[MODULE_ID].rules : Object.values(this.item.flags[MODULE_ID]?.rules || {});
        const oldWizardRules = currentRules.filter(r => r.isWizardRule);
        
        await this.item.update({ [`flags.${MODULE_ID}.rules`]: [...manualRules, ...oldWizardRules] });
        this.render({force: true});
    }

    async _onAddDamagePart(event, target) {
        let parts = Array.isArray(this.item.flags[MODULE_ID]?.damageParts) ? [...this.item.flags[MODULE_ID].damageParts] : Object.values(this.item.flags[MODULE_ID]?.damageParts || {});

        try {
            const fd = new FormDataExtended(this.element).object;
            const expanded = foundry.utils.expandObject(fd);
            if (expanded.flags?.[MODULE_ID]?.damageParts) parts = Object.values(expanded.flags[MODULE_ID].damageParts);
        } catch(e) {}
        
        parts.push({ dice: "", die: "d6", type: "" });
        await this.item.update({ 
            [`flags.${MODULE_ID}.damageParts`]: parts, 
            [`flags.${MODULE_ID}.useCustomDamage`]: true 
        });
        this.render({force: true});
    }

    async _onDeleteDamagePart(event, target) {
        const index = target.dataset.index;
        let parts = Array.isArray(this.item.flags[MODULE_ID]?.damageParts) ? [...this.item.flags[MODULE_ID].damageParts] : Object.values(this.item.flags[MODULE_ID]?.damageParts || {});
        try {
            const fd = new FormDataExtended(this.element).object;
            const expanded = foundry.utils.expandObject(fd);
            if (expanded.flags?.[MODULE_ID]?.damageParts) parts = Object.values(expanded.flags[MODULE_ID].damageParts);
        } catch(e) {}
        
        parts.splice(index, 1);
        await this.item.update({ 
            [`flags.${MODULE_ID}.damageParts`]: parts, 
            [`flags.${MODULE_ID}.useCustomDamage`]: true 
        });
        this.render({force: true});
    }

    async _onAddWizardEffect(event, target) {
        let effects = Array.isArray(this.item.flags[MODULE_ID]?.wizardEffects) ? [...this.item.flags[MODULE_ID].wizardEffects] : Object.values(this.item.flags[MODULE_ID]?.wizardEffects || {});
        try {
            const fd = new FormDataExtended(this.element).object;
            const expanded = foundry.utils.expandObject(fd);
            if (expanded.flags?.[MODULE_ID]?.wizardEffects) effects = Object.values(expanded.flags[MODULE_ID].wizardEffects);
        } catch(e) {}
        
        effects.push({ slug: "frightened", value: 1, duration: "", outcome: "failure" });
        await this.item.update({ 
            [`flags.${MODULE_ID}.wizardEffects`]: effects, 
            [`flags.${MODULE_ID}.useWizardEffects`]: true 
        });
        this.render({force: true});
    }

    async _onDeleteWizardEffect(event, target) {
        const index = target.dataset.index;
        let effects = Array.isArray(this.item.flags[MODULE_ID]?.wizardEffects) ? [...this.item.flags[MODULE_ID].wizardEffects] : Object.values(this.item.flags[MODULE_ID]?.wizardEffects || {});
        try {
            const fd = new FormDataExtended(this.element).object;
            const expanded = foundry.utils.expandObject(fd);
            if (expanded.flags?.[MODULE_ID]?.wizardEffects) effects = Object.values(expanded.flags[MODULE_ID].wizardEffects);
        } catch(e) {}
        
        effects.splice(index, 1);
        await this.item.update({ 
            [`flags.${MODULE_ID}.wizardEffects`]: effects, 
            [`flags.${MODULE_ID}.useWizardEffects`]: true 
        });
        this.render({force: true});
    }

    async _onToggleWizard(event, target) {
        const current = this.item.getFlag(MODULE_ID, "wizardMode") ?? true;
        await this.item.setFlag(MODULE_ID, "wizardMode", !current);
        this.render({ force: true });
    }
}

// --- ITEM SHEET INJECTION (THE CLEAN ENTRY POINTS) ---
Hooks.on("getItemSheetHeaderButtons", (app, buttons) => {
    if (!["spell", "feat", "action", "consumable", "weapon", "equipment", "melee"].includes(app.item.type)) return;
    buttons.unshift({
        label: "AoE",
        class: "aoe-config-header-btn",
        icon: "fas fa-bullseye",
        onclick: () => AoEItemConfigApp.show(app.item)
    });
});

Hooks.on("renderItemSheet", async (app, html, data) => {
    if (!["spell", "feat", "action", "consumable", "weapon", "equipment", "melee"].includes(app.item.type)) return;
    
    const flags = app.item.flags[MODULE_ID] || {};
    const rulesCount = Array.isArray(flags.rules) ? flags.rules.length : Object.keys(flags.rules || {}).length;
    const hasZone = flags.hazardDuration || flags.terrainEffect === "difficult" || flags.terrainEffect === "greater";
    const isConfigured = flags.useOverride || flags.useCustomDamage || flags.provideTemplate || rulesCount > 0 || flags.enableMultiTarget || flags.isAreaDamage || hasZone;
    
    const $html = html instanceof jQuery ? html : $(html);
    let insertTarget = $html.find(".tab[data-tab='details']");
    if (insertTarget.length === 0) insertTarget = $html.find("form");

    let pills = [];

    if (flags.provideTemplate) {
        const tType = flags.templateType ? flags.templateType.charAt(0).toUpperCase() + flags.templateType.slice(1) : "Burst";
        const tDist = flags.templateDistance || 15;
        pills.push(`<span style="background: #8e44ad; color: white; padding: 2px 8px; border-radius: 12px; font-size: 0.8em; font-weight: bold;">${tDist} ft ${tType}</span>`);
    } else if (flags.enableMultiTarget) {
        pills.push(`<span style="background: #8e44ad; color: white; padding: 2px 8px; border-radius: 12px; font-size: 0.8em; font-weight: bold;">Multi-Target</span>`);
    } else if (flags.tacticalDrawing) {
        pills.push(`<span style="background: #8e44ad; color: white; padding: 2px 8px; border-radius: 12px; font-size: 0.8em; font-weight: bold;">Tactical Shape</span>`);
    }

    if (flags.useOverride) {
        const sType = flags.saveType ? flags.saveType.charAt(0).toUpperCase() + flags.saveType.slice(1) : "Reflex";
        const sDC = flags.dcType === "custom" && flags.saveDC ? flags.saveDC : (flags.dcType ? flags.dcType.charAt(0).toUpperCase() + flags.dcType.slice(1) : "Highest");
        const basicText = flags.isBasicSave !== false ? "basic " : "";
        pills.push(`<span style="background: #3498db; color: white; padding: 2px 8px; border-radius: 12px; font-size: 0.8em; font-weight: bold;">DC ${sDC} ${basicText}${sType}</span>`);
    } else if (app.item.system?.defense?.save?.statistic) {
        const stat = app.item.system.defense.save.statistic;
        const sType = stat.charAt(0).toUpperCase() + stat.slice(1);
        const sDC = app.item.system.defense.save.dc?.value || "Highest";
        const basicText = app.item.system.defense.save.basic ? "basic " : "";
        pills.push(`<span style="background: #3498db; color: white; padding: 2px 8px; border-radius: 12px; font-size: 0.8em; font-weight: bold;">DC ${sDC} ${basicText}${sType} (Native)</span>`);
    }

    if (flags.useCustomDamage && flags.baseDamage) {
        pills.push(`<span style="background: #e74c3c; color: white; padding: 2px 8px; border-radius: 12px; font-size: 0.8em; font-weight: bold;">${flags.baseDamage} damage</span>`);
    } else if (app.item.system?.damage && Object.keys(app.item.system.damage).length > 0) {
        pills.push(`<span style="background: #e74c3c; color: white; padding: 2px 8px; border-radius: 12px; font-size: 0.8em; font-weight: bold;">Native Damage</span>`);
    }

    if (rulesCount > 0) {
        pills.push(`<span style="background: #2ecc71; color: white; padding: 2px 8px; border-radius: 12px; font-size: 0.8em; font-weight: bold;">Additional Effects</span>`);
    }

    if (hasZone) {
        pills.push(`<span style="background: #f1c40f; color: black; padding: 2px 8px; border-radius: 12px; font-size: 0.8em; font-weight: bold;">Hazard Zone</span>`);
    }

    const bannerHtml = `
        <div class="aoe-summary-banner" style="border: 1px solid #7a7971; border-radius: 4px; padding: 8px; margin-bottom: 10px; background: rgba(0,0,0,0.05); display: flex; justify-content: space-between; align-items: center;">
            <div style="display: flex; gap: 6px; flex-wrap: wrap; align-items: center;">
                <i class="fas fa-bullseye" style="font-size: 1.2em; color: #7a7971; margin-right: 4px;"></i>
                ${!isConfigured ? `<span style="color: #777; font-style: italic; font-size: 0.9em;">System Default (No AoE Overrides)</span>` : pills.join("")}
            </div>
            <button type="button" class="aoe-config-launch-btn" style="flex: 0 0 auto; width: auto; padding: 0 10px; height: 26px; line-height: 24px; font-size: 0.9em;"><i class="fas fa-cogs"></i> Configure</button>
        </div>
    `;
    
    insertTarget.prepend(bannerHtml);
    $html.find(".aoe-config-launch-btn").on("click", (ev) => {
        ev.preventDefault();
        AoEItemConfigApp.show(app.item);
    });
});

// --- CHAT MESSAGE ROUTER & AUTO-APPLY ---
Hooks.on("createChatMessage", async (message, options, userId) => {
    const flags = message.flags[MODULE_ID];

    if (message.isAuthor) {
        const context = message.flags?.pf2e?.context;
        if (!context) return;

        if (context.type === "saving-throw") {
            const actor = message.actor;
            if (actor) {
                const recentAoEMsgs = game.messages.filter(m => {
                    if (Date.now() - m.timestamp > 1800000) return false; 
                    
                    const f = m.flags[MODULE_ID];
                    return f && f.targets && Object.values(f.targets).some(t => {
                        const tok = canvas.tokens.get(t.id);
                        return tok && tok.actor?.id === actor.id && !t.hasRolled && !t.hasApplied;
                    });
                }).sort((a, b) => b.timestamp - a.timestamp);

                if (recentAoEMsgs.length > 0) {
                    const targetMessage = recentAoEMsgs[0];
                    const aoeData = targetMessage.flags[MODULE_ID];
                    
                    const targetData = Object.values(aoeData.targets).find(t => {
                        const tok = canvas.tokens.get(t.id);
                        return tok && tok.actor?.id === actor.id && !t.hasRolled && !t.hasApplied;
                    });

                    if (targetData) {
                        const tokenId = targetData.id;
                        const roll = message.rolls?.[0];
                        
                        if (roll) {
                            let d20 = 10;
                            const d20Term = roll.terms?.find(t => t.faces === 20);
                            if (d20Term) d20 = d20Term.results?.[0]?.result ?? d20Term.total ?? 10;
                            else if (roll.dice?.[0]) d20 = roll.dice[0].results?.[0]?.result ?? roll.dice[0].total ?? 10;
                            
                            const modifier = roll.total - d20;
                            const saveType = context.saveType || aoeData.saveType; 
                            const rollTooltip = buildRollTooltip(actor, saveType, roll, d20, modifier);
                            
                            const rawDosValue = getUnadjustedDos(roll.total, aoeData.saveDC, d20);
                            let finalDosValue = roll.degreeOfSuccess ?? roll.options?.degreeOfSuccess ?? context.outcome;
                            
                            const dosMap = { 0: "criticalFailure", 1: "failure", 2: "success", 3: "criticalSuccess", "criticalFailure": "criticalFailure", "failure": "failure", "success": "success", "criticalSuccess": "criticalSuccess" };
                            let dos = dosMap[finalDosValue] || dosMap[rawDosValue] || "success";
                            let unadjustedDos = rawDosValue !== undefined ? dosMap[rawDosValue] : dos;

                            setTimeout(async () => { try { await message.delete(); } catch(e){} }, 100);

                            window.aoeEasyResolveRoute("updateSaveRoll", {
                                messageId: targetMessage.id,
                                tokenId: tokenId,
                                rollTotal: roll.total,
                                rollFormula: roll.formula,
                                rollTooltip: rollTooltip,
                                dos: dos,
                                unadjustedDos: unadjustedDos,
                                hasUsedHeroPoint: false,
                                hasCover: false
                            });
                            
                            ui.notifications.info(`AoE Easy Resolve | Intercepted save for ${actor.name}.`);
                            return; 
                        }
                    }
                }
            }
        }

        if (context.type === "damage-roll") {
            const itemUuid = message.item?.uuid || message.flags?.pf2e?.origin?.uuid;
            if (itemUuid) {
                const recentAoEMsgs = game.messages.filter(m => {
                    if (Date.now() - m.timestamp > 1800000) return false; 
                    
                    const f = m.flags[MODULE_ID];
                    return f && f.itemUuid === itemUuid && (f.damageTotal === undefined || f.damageTotal === null);
                }).sort((a, b) => b.timestamp - a.timestamp);

                if (recentAoEMsgs.length > 0) {
                    const targetMessage = recentAoEMsgs[0];
                    const dRoll = message.rolls?.[0];
                    
                    if (dRoll) {
                        const damageJSON = JSON.stringify(dRoll.toJSON());
                        const damageTotal = dRoll.total;
                        const damageFormula = dRoll.formula;

                        let tooltipParts = [];
                        if (dRoll.instances) {
                            dRoll.instances.forEach(inst => {
                                let type = inst.type ? inst.type.charAt(0).toUpperCase() + inst.type.slice(1) : "Untyped";
                                let formula = inst.formula || inst.head?.expression || "";
                                let diceRolls = [];
                                inst.dice?.forEach(d => {
                                    diceRolls.push(`[${d.results.map(r => r.result).join(",")}]`);
                                });
                                let diceStr = diceRolls.length > 0 ? ` (Rolls: ${diceRolls.join(", ")})` : "";
                                tooltipParts.push(`<strong>${type}</strong>: ${formula}${diceStr}`);
                            });
                        } else if (dRoll.dice) {
                            dRoll.dice.forEach(d => tooltipParts.push(`d${d.faces}: [${d.results.map(r => r.result).join(", ")}]`));
                        }
                        
                        let dmgMsg = message;
                        if (dmgMsg && dmgMsg.flags?.pf2e?.modifiers) {
                            const mods = dmgMsg.flags.pf2e.modifiers.filter(m => m.enabled && !m.ignored);
                            if (mods.length > 0) {
                                tooltipParts.push(`<hr style="margin: 3px 0; border-color: #777;">`);
                                mods.forEach(m => {
                                    let sign = m.modifier >= 0 ? "+" : "";
                                    tooltipParts.push(`<span style="color: #4ade80;">${m.label}</span>: ${sign}${m.modifier} ${m.type || ""}`);
                                });
                            }
                        }
                        
                        const damageTooltip = tooltipParts.length > 0 ? tooltipParts.join("<br>") : damageFormula;

                        let breakdownArr = [];
                        if (dRoll.instances) {
                            dRoll.instances.forEach(i => {
                                const type = i.type || "untyped";
                                const cleanType = type.charAt(0).toUpperCase() + type.slice(1);
                                breakdownArr.push(`${i.total} ${cleanType}`);
                            });
                        }
                        const damageBreakdown = breakdownArr.length > 0 ? breakdownArr.join(", ") : damageTotal;

                        setTimeout(async () => { try { await message.delete(); } catch(e){} }, 100);

                        window.aoeEasyResolveRoute("updateDamageRoll", {
                            messageId: targetMessage.id,
                            damageJSON: damageJSON,
                            damageTotal: damageTotal,
                            damageBreakdown: damageBreakdown,
                            damageFormula: damageFormula,
                            damageTooltip: damageTooltip
                        });
                        
                        ui.notifications.info(`AoE Easy Resolve | Intercepted damage roll for ${message.item?.name || "spell"}.`);
                        return; 
                    }
                }
            }
        }

        // --- ORIGINAL ATTACK ROUTER ---
        if (context.type === "attack-roll") {
            const outcome = context.outcome; 
            if (!outcome) return;

            const item = message.item;
            if (!item) return;

            const targets = Array.from(game.user.targets);
            await executeEffectRules(targets, "attack", outcome, item, message.actor);
        }
    }
});

// --- CHAT CARD INTERACTIVITY ---
Hooks.on("renderChatMessageHTML", (message, html, data) => {
    const item = message.item;
    const flags = item?.flags[MODULE_ID] || {};

    const contextType = message.flags.pf2e?.context?.type;
    const isRollCard = message.isRoll || message.rolls?.length > 0 || (contextType && contextType !== "spell-cast" && contextType !== "item-chat");
    const isTactical = flags.tacticalDrawing || false;
    
    const $html = html instanceof jQuery ? html : $(html);
    $html.find('[data-token-id]').each((i, el) => {
        const $row = $(el);
        const tokenId = $row.attr('data-token-id');
        if (tokenId) {
            Hooks.callAll("aoeEasyResolve.renderRow", message, $row, tokenId);
        }
    });

    if (item && !isRollCard) {
        if ($html.find(".er-template-toolbar").length === 0) {
            const hasTemplateTools = flags.provideTemplate || isTactical;
            const hasMultiTarget = flags.enableMultiTarget;

            if (hasTemplateTools || hasMultiTarget) {
                let buttonsHtml = `<div class="er-template-toolbar" style="display: flex; flex-wrap: wrap; gap: 4px; margin-top: 5px;">`;
                
                if (flags.provideTemplate) {
                    const shapeType = flags.templateType || "circle";
                    if (shapeType === "circle" || shapeType === "burst") {
                        buttonsHtml += `<button type="button" class="er-draw-shape-btn" data-shape="burst" style="flex: 1; border: 1px solid #7a7971; background: rgba(0,0,0,0.1);"><i class="fas fa-circle"></i> Burst</button>`;
                    } else if (shapeType === "cone") {
                        buttonsHtml += `<button type="button" class="er-draw-shape-btn" data-shape="cone" style="flex: 1; border: 1px solid #7a7971; background: rgba(0,0,0,0.1);"><i class="fas fa-play"></i> Cone</button>`;
                    } else if (shapeType === "ray" || shapeType === "line") {
                        buttonsHtml += `<button type="button" class="er-draw-shape-btn" data-shape="line" style="flex: 1; border: 1px solid #7a7971; background: rgba(0,0,0,0.1);"><i class="fas fa-ruler-horizontal"></i> Line</button>`;
                    }
                }
                
                if (isTactical) {
                    buttonsHtml += `
                      <button type="button" class="er-draw-rect-btn" title="Stamp Contiguous Squares" style="flex: 1; border: 1px solid #7a7971; background: rgba(0,0,0,0.1);"><i class="fas fa-stamp"></i> Stamp</button>
                      <button type="button" class="er-draw-poly-btn" title="Freehand Shape" style="flex: 1; border: 1px solid #7a7971; background: rgba(0,0,0,0.1);"><i class="fas fa-draw-polygon"></i> Free</button>
                    `;
                }
                
                if (hasMultiTarget) {
                    buttonsHtml += `
                        <button type="button" class="er-resolve-targets-btn" title="Resolve on currently targeted tokens" style="flex: 1; border: 1px solid #7a7971; background: rgba(0,0,0,0.1);"><i class="fas fa-bullseye"></i> Resolve Targets</button>
                    `;
                }
                buttonsHtml += `</div>`;
                
                $html.find(".message-content").append(buttonsHtml);
            }

            const prepCache = () => {
                let finalDC = flags.useOverride 
                ? getSystemSaveDC(item, flags.dcType, flags.saveDC) 
                : (item.system?.defense?.save?.dc?.value || getSystemSaveDC(item, "spell"));
                let finalType = flags.useOverride ? flags.saveType : (item.system?.defense?.save?.statistic || null);

                if (!finalDC) {
                    const dcMatch = $html.text().match(/DC\s*(\d+)/i);
                    if (dcMatch) finalDC = parseInt(dcMatch[1], 10);
                }
                if (!finalType) {
                    const cardText = $html.text().toLowerCase();
                    if (cardText.includes("fortitude")) finalType = "fortitude";
                    else if (cardText.includes("will")) finalType = "will";
                    else finalType = "reflex"; 
                }

                window.aoeEasyResolveCache = {
                    item: item, name: item.name,
                    dc: finalDC, type: finalType,
                    hazardDuration: flags.hazardDuration || null
                };
            };

            $html.find(".er-draw-shape-btn").off("click").on("click", async (ev) => {
                ev.preventDefault();
                prepCache();
                const shapeType = $(ev.currentTarget).data("shape");
                const targetDistance = flags.templateDistance || 15;

                const linkText = `@Template[type:${shapeType}|distance:${targetDistance}]`;
                const enriched = await TextEditor.enrichHTML(`<div>${linkText}</div>`, { async: true });
                
                const ghostContainer = document.createElement("div");
                ghostContainer.style.display = "none";
                ghostContainer.innerHTML = typeof enriched === "string" ? enriched : enriched.outerHTML;
                ev.currentTarget.parentNode.appendChild(ghostContainer);
                
                const ghostBtn = ghostContainer.firstElementChild?.firstElementChild;
                if (ghostBtn) ghostBtn.dispatchEvent(new MouseEvent('click', { view: window, bubbles: true, cancelable: true }));
                setTimeout(() => ghostContainer.remove(), 100);
            });

            $html.find(".er-draw-poly-btn").off("click").on("click", async (ev) => {
                ev.preventDefault();
                prepCache();
                
                canvas.regions.activate();
                
                setTimeout(() => {
                    if (typeof ui.controls?.initialize === "function") {
                        ui.controls.initialize({ control: "regions", tool: "polygon" });
                    }
                }, 100);
                
                const limitTxt = flags.tacticalBlocks ? ` You have a limit of ${flags.tacticalBlocks} contiguous squares.` : "";
                ui.notifications.info(`AoE Easy Resolve | Click points to draw a freehand shape.${limitTxt}`);
            });
      
            $html.find(".er-draw-rect-btn").off("click").on("click", async (ev) => {
                ev.preventDefault();
                prepCache();
                
                const limit = parseInt(flags.tacticalBlocks) || 4;
                let shapes = [];
                
                ui.notifications.info(`AoE Easy Resolve | STAMP MODE: Click grid squares to stamp up to ${limit} squares. Right-click to finish early.`);
                canvas.regions.activate();
                
                const ghostContainer = new PIXI.Container();
                canvas.interface.addChild(ghostContainer);
                
                const size = canvas.dimensions.size;
                const numColor = Color.from(game.user.color || "#ff0000").valueOf();
      
                // THE UPGRADE: The Hover Cursor
                const hoverCursor = new PIXI.Graphics();
                hoverCursor.beginFill(numColor, 0.15); // Faint fill
                hoverCursor.lineStyle(2, numColor, 0.4); // Faint border
                hoverCursor.drawRect(0, 0, size, size);
                hoverCursor.endFill();
                ghostContainer.addChild(hoverCursor);
                
                const finishStamping = async () => {
                    canvas.app.stage.off('pointerdown', onStampClick);
                    canvas.app.stage.off('pointermove', onStampMove); // Kill the tracker
                    ghostContainer.destroy({ children: true });
                    
                    if (shapes.length > 0) {
                        const castLevel = message.flags?.pf2e?.origin?.castLevel || item?.system?.level?.value || 1;
                        await canvas.scene.createEmbeddedDocuments("Region", [{
                            name: `${item?.name || "Hazard"} Zone`,
                            color: game.user.color,
                            shapes: shapes,
                            elevation: { bottom: -1000, top: 1000 },
                            flags: { pf2e: { origin: { uuid: item?.uuid, castLevel: castLevel } } }
                        }]);
                    } else {
                        ui.notifications.warn("AoE Easy Resolve | Stamping cancelled (no squares placed).");
                    }
                };
                
                // Abstracted the grid snapping so both listeners can use it
                const getSnappedPosition = (pos) => {
                    try {
                        if (canvas.grid.getTopLeftPoint) {
                            const pt = canvas.grid.getTopLeftPoint(pos);
                            return { sx: pt.x, sy: pt.y };
                        } else {
                                const rc = canvas.grid.grid.getGridPositionFromPixels(pos.x, pos.y);
                                const pt = canvas.grid.grid.getPixelsFromGridPosition(rc[0], rc[1]);
                                return { sx: pt[0], sy: pt[1] };
                        }
                    } catch(e) {
                        return { sx: Math.floor(pos.x / size) * size, sy: Math.floor(pos.y / size) * size };
                    }
                };
      
                const onStampMove = (event) => {
                    const pos = event.data.getLocalPosition(canvas.interface);
                    const { sx, sy } = getSnappedPosition(pos);
                    
                    hoverCursor.x = sx;
                    hoverCursor.y = sy;
                    
                    // Hide the hover cursor if we are hovering over an already-stamped square
                    if (shapes.some(s => s.x === sx && s.y === sy)) {
                        hoverCursor.alpha = 0;
                    } else {
                        hoverCursor.alpha = 1;
                    }
                };
      
                const onStampClick = async (event) => {
                    if (event.data.button === 2) return finishStamping(); // Right-click finishes early
                    if (event.data.button !== 0) return; // Ignore middle-clicks
                    
                    const pos = event.data.getLocalPosition(canvas.interface);
                    const { sx, sy } = getSnappedPosition(pos);
                    
                    if (shapes.some(s => s.x === sx && s.y === sy)) return;
                    
                    shapes.push({ type: "rectangle", x: sx, y: sy, width: size, height: size });
                    
                    // Draw the permanent stamped square
                    const g = new PIXI.Graphics();
                    g.beginFill(numColor, 0.4);
                    g.lineStyle(2, numColor, 0.8);
                    g.drawRect(sx, sy, size, size);
                    g.endFill();
                    ghostContainer.addChild(g);
                    
                    // Keep hover cursor on top of the newly dropped graphic
                    ghostContainer.addChild(hoverCursor); 
      
                    if (shapes.length >= limit) finishStamping();
                };
                
                setTimeout(() => {
                    canvas.app.stage.on('pointerdown', onStampClick);
                    canvas.app.stage.on('pointermove', onStampMove);
                }, 100);
            });

            // --- MULTI-TARGET RESOLUTION LISTENER ---
            $html.find(".er-resolve-targets-btn").off("click").on("click", async (ev) => {
                ev.preventDefault();
                console.log("AoE Easy Resolve | 'Resolve Targets' button clicked.");
                
                try {
                    const targets = Array.from(game.user.targets);
                    console.log(`AoE Easy Resolve | Found ${targets.length} highlighted targets.`);
                    
                    if (targets.length === 0) {
                        return ui.notifications.warn("AoE Easy Resolve | You must target tokens on the canvas first!");
                    }

                    let finalDC = flags.useOverride ? getSystemSaveDC(item, flags.dcType, flags.saveDC) : (item?.system?.defense?.save?.dc?.value || null);
                    let finalType = flags.useOverride ? flags.saveType : (item?.system?.defense?.save?.statistic || null);

                    if (!finalDC) {
                        const dcMatch = $html.text().match(/DC\s*(\d+)/i);
                        if (dcMatch) finalDC = parseInt(dcMatch[1], 10);
                    }
                    if (!finalType) {
                        const cardText = $html.text().toLowerCase();
                        if (cardText.includes("fortitude")) finalType = "fortitude";
                        else if (cardText.includes("will")) finalType = "will";
                        else finalType = "reflex"; 
                    }

                    console.log("AoE Easy Resolve | Sending targets to generator...");
                    await generateTemplateCard(null, {
                        itemName: item?.name || "Targeted Effects", 
                        saveType: finalType, 
                        saveDC: finalDC, 
                        isBasicSave: item?.system?.defense?.save?.basic ?? true, 
                        originItem: item, 
                        hazardDamage: flags.hazardDamage || null,
                        hazardDuration: flags.hazardDuration || null,
                        originMessageId: message.id,
                        preselectedTargets: targets
                    });
                    
                } catch (err) {
                    console.error("AoE Easy Resolve | Fatal error resolving targets:", err);
                }
            });
        }
    }

    const templateButtons = $html.find('[data-pf2-action="createTemplate"], .inline-template, button[data-action="spellTemplate"], button[data-action="place-template"], button:contains("burst"), button:contains("cone"), button:contains("line"), button:contains("emanation")');
    templateButtons.on("click", (ev) => {
        const aoeFlags = item?.flags[MODULE_ID] || {};
        let fallbackName = item?.name || "AoE Effects";
        if (!item && message.flavor) fallbackName = message.flavor.replace(/<[^>]*>?/gm, '').trim();

        let finalDC = aoeFlags.useOverride 
            ? getSystemSaveDC(item, aoeFlags.dcType, aoeFlags.saveDC) 
            : (item?.system?.defense?.save?.dc?.value || getSystemSaveDC(item, "spell"));
        let finalType = aoeFlags.useOverride ? aoeFlags.saveType : (item?.system?.defense?.save?.statistic || null);

        if (!finalDC) {
            const dcMatch = $html.text().match(/DC\s*(\d+)/i);
            if (dcMatch) finalDC = parseInt(dcMatch[1], 10);
        }
        if (!finalType) {
            const cardText = $html.text().toLowerCase();
            if (cardText.includes("fortitude")) finalType = "fortitude";
            else if (cardText.includes("will")) finalType = "will";
            else finalType = "reflex"; 
        }
        window.aoeEasyResolveCache = { 
            item: item, 
            name: fallbackName, 
            dc: finalDC, 
            type: finalType, 
            hazardDuration: aoeFlags.hazardDuration || null, 
            originMessageId: message.id 
        };
    });

    const targetsFlag = message.getFlag(MODULE_ID, "targets");
    if (!targetsFlag) return; 
    
    const aoeData = message.flags[MODULE_ID] || {};
    const isGM = game.user.isGM;

    $html.find('[data-token-id]').each((i, el) => {
        const $row = $(el);
        const tokenId = $row.attr('data-token-id');
        Hooks.callAll("aoeEasyResolve.renderRow", message, $row, tokenId);
    });

    $html.find(".roll-save-btn").each((index, element) => {
        const btn = $(element);
        const tokenId = element.dataset.tokenId;
        const token = canvas.tokens?.get(tokenId);
        const targetData = aoeData.targets[tokenId];

        if (targetData && !targetData.hasRolled) {
            btn.addClass("er-pulse-player");
        }

        if (!isGM) {
            if (!token || !token.actor?.isOwner) btn.replaceWith('<span style="color: #777; font-style: italic; padding: 4px;">Awaiting...</span>');
        }
    });

    if (!isGM) {
        $html.find(".apply-damage-btn").hide();
        $html.find(".roll-all-npcs-btn").hide();
        if (!message.isAuthor) $html.find(".roll-damage-btn").hide();
    }

    if (isGM || message.isAuthor) {
        (async () => {
            let originItem = item;
            if (!originItem && aoeData.originMessageId) {
                const originMsg = game.messages.get(aoeData.originMessageId);
                if (originMsg) originItem = originMsg.item;
            }
            if (!originItem && aoeData.itemUuid) {
                try { originItem = await fromUuid(aoeData.itemUuid); } catch (e) {}
            }
            
            const aoeFlags = originItem?.flags?.[MODULE_ID] || {};
            const itemHasDamage = aoeData.hazardDamage || 
                                  (originItem?.system?.damage && Object.keys(originItem.system.damage).length > 0) || 
                                  (aoeFlags.useCustomDamage && aoeFlags.baseDamage);

            if (itemHasDamage && (aoeData.damageTotal === undefined || aoeData.damageTotal === null)) {
                $html.find(".roll-damage-btn").addClass("er-pulse-gm");
            }

            let hasUnappliedTargets = false;
            for (const target of Object.values(aoeData.targets || {})) {
                if (!target.hasApplied && (target.hasRolled || target.isHealing)) {
                    hasUnappliedTargets = true;
                    break;
                }
            }

            if (hasUnappliedTargets) {
                if (!itemHasDamage || (aoeData.damageTotal !== undefined && aoeData.damageTotal !== null)) {
                    $html.find(".apply-damage-btn").addClass("er-pulse-apply");
                }
            }
        })();
    }

    $html.find(".roll-damage-btn").off("click").on("click", async (event) => {
        event.preventDefault();
        const aoeData = message.flags[MODULE_ID];
        
        let originItem = null;
        if (aoeData.originMessageId) {
            const originMsg = game.messages.get(aoeData.originMessageId);
            if (originMsg) originItem = originMsg.item;
        }
        if (!originItem && aoeData.itemUuid) { 
            try { originItem = await fromUuid(aoeData.itemUuid); } catch(e) {} 
        }

        const aoeFlags = originItem?.flags?.[MODULE_ID] || {};
        const hazardDamage = aoeData.hazardDamage; 
        
        const useCustomDamage = aoeFlags.useCustomDamage || !!hazardDamage;
        const baseDamage = aoeFlags.baseDamage || aoeFlags.customDamage;
        const customDamageFormula = hazardDamage || compileHeightenedDamage(originItem, baseDamage, aoeFlags.scaleDamage, aoeFlags.scaleMode, aoeData.castLevel);
        const customDamageType = aoeFlags.customDamageType;

        let dRoll = null;
        let rollFlags = null;

        if (useCustomDamage && customDamageFormula) {
            const pf2eDamageClass = CONFIG.Dice.rolls.find(r => r.name === "DamageRoll") || Roll;
            try {
                let safeFormula = customDamageFormula.replace(/\]\s*\+\s*/g, "], ");
                const rollData = originItem ? originItem.getRollData() : {};
                safeFormula = Roll.replaceFormulaData(safeFormula, rollData);
                
                const fullFormula = customDamageType ? `(${safeFormula})[${customDamageType}]` : safeFormula;
                dRoll = new pf2eDamageClass(fullFormula, rollData);
                await dRoll.evaluate();
            } catch (e) {
                ui.notifications.error(`AoE Easy Resolve | Invalid custom damage formula: ${customDamageFormula}`);
                return;
            }
        } else if (originItem?.system?.damage && Object.keys(originItem.system.damage).length > 0) {
            window.aoeEasyResolveRollingDamage = true;
            window.aoeEasyResolveDamageRollData = null;

            const rollOptions = { event: event };
            if (aoeData.castLevel) rollOptions.spellLevel = parseInt(aoeData.castLevel, 10);

            await originItem.rollDamage(rollOptions);
            await new Promise(resolve => setTimeout(resolve, 50));
            
            if (window.aoeEasyResolveDamageRollData && window.aoeEasyResolveDamageRollData.rolls?.length > 0) {
                dRoll = window.aoeEasyResolveDamageRollData.rolls[0];
                rollFlags = window.aoeEasyResolveDamageRollData.flags;
            }
            
            window.aoeEasyResolveRollingDamage = false;

            if (!dRoll) {
                ui.notifications.error("AoE Easy Resolve | Could not intercept damage roll.");
                return;
            }
        } else {
            ui.notifications.info("AoE Easy Resolve | This item has no damage configured.");
            return;
        }

        if (game.dice3d && dRoll) await game.dice3d.showForRoll(dRoll, game.user, true);

        const damageJSON = JSON.stringify(dRoll.toJSON());
        const damageTotal = dRoll.total;
        const damageFormula = dRoll.formula;

        let tooltipParts = [];
        if (dRoll.instances) {
            dRoll.instances.forEach(inst => {
                let type = inst.type ? inst.type.charAt(0).toUpperCase() + inst.type.slice(1) : "Untyped";
                let formula = inst.formula || inst.head?.expression || "";
                let diceRolls = [];
                inst.dice?.forEach(d => {
                    diceRolls.push(`[${d.results.map(r => r.result).join(",")}]`);
                });
                let diceStr = diceRolls.length > 0 ? ` (Rolls: ${diceRolls.join(", ")})` : "";
                tooltipParts.push(`<strong>${type}</strong>: ${formula}${diceStr}`);
            });
        } else if (dRoll.dice) {
            dRoll.dice.forEach(d => tooltipParts.push(`d${d.faces}: [${d.results.map(r => r.result).join(", ")}]`));
        }

        if (rollFlags && rollFlags.pf2e?.modifiers) {
            const mods = rollFlags.pf2e.modifiers.filter(m => m.enabled && !m.ignored);
            if (mods.length > 0) {
                tooltipParts.push(`<hr style="margin: 3px 0; border-color: #777;">`);
                mods.forEach(m => {
                    let sign = m.modifier >= 0 ? "+" : "";
                    tooltipParts.push(`<span style="color: #4ade80;">${m.label}</span>: ${sign}${m.modifier} ${m.type || ""}`);
                });
            }
        }
        
        const damageTooltip = tooltipParts.length > 0 ? tooltipParts.join("<br>") : damageFormula;

        let breakdownArr = [];
        if (dRoll.instances) {
            dRoll.instances.forEach(i => {
                const type = i.type || "untyped";
                const cleanType = type.charAt(0).toUpperCase() + type.slice(1);
                breakdownArr.push(`${i.total} ${cleanType}`);
            });
        }
        const damageBreakdown = breakdownArr.length > 0 ? breakdownArr.join(", ") : damageTotal;
        
        window.aoeEasyResolveRoute("updateDamageRoll", {
            messageId: message.id,
            damageJSON: damageJSON,
            damageTotal: damageTotal,
            damageBreakdown: damageBreakdown,
            damageFormula: damageFormula,
            damageTooltip: damageTooltip
        });
    });

    $html.find(".roll-all-npcs-btn").off("click").on("click", async (event) => {
        event.preventDefault();
        const aoeData = message.flags[MODULE_ID];
        if (!aoeData || !aoeData.targets) return;

        const saveType = aoeData.saveType || "reflex";
        const saveDC = aoeData.saveDC;
        
        let originItem = null;
        if (aoeData.originMessageId) {
            const originMsg = game.messages.get(aoeData.originMessageId);
            if (originMsg) originItem = originMsg.item;
        }
        if (!originItem && aoeData.itemUuid) { 
            try { originItem = await fromUuid(aoeData.itemUuid); } catch(e) {} 
        }
        
        const hasDamage = aoeData.hazardDamage || (originItem?.system?.damage && Object.keys(originItem.system.damage).length > 0);
        const extraRollOptions = [];
        
        if (saveType === "reflex") {
            extraRollOptions.push("area-effect");
            if (hasDamage) extraRollOptions.push("damaging-effect");
        }

        const npcsToRoll = [];
        for (const [tokenId, targetData] of Object.entries(aoeData.targets)) {
            if (targetData.hasRolled || targetData.isHealing || targetData.isImmune) continue;
            const token = canvas.tokens.get(tokenId);
            if (token && token.actor && !token.actor.hasPlayerOwner) npcsToRoll.push({ tokenId, token });
        }
        
        if (npcsToRoll.length === 0) { 
            ui.notifications.info("AoE Easy Resolve | No NPCs left to roll for."); 
            return; 
        }
        
        const updateData = {};
        for (const {tokenId, token} of npcsToRoll) {
            const rollOptions = { event: event, createMessage: false, skipDialog: true };
            if (saveDC) rollOptions.dc = { value: saveDC };
            if (extraRollOptions.length > 0) rollOptions.extraRollOptions = extraRollOptions;
            
            const rollResult = await token.actor.saves[saveType].roll(rollOptions);
            if (!rollResult) continue;
            if (game.dice3d) game.dice3d.showForRoll(rollResult, game.user, true);
            
            let d20 = 10;
            const d20Term = rollResult.terms?.find(t => t.faces === 20);
            if (d20Term) d20 = d20Term.results?.[0]?.result ?? d20Term.total ?? 10;
            else if (rollResult.dice?.[0]) d20 = rollResult.dice[0].results?.[0]?.result ?? rollResult.dice[0].total ?? 10;

            const modifier = rollResult.total - d20;
            const rollTooltip = buildRollTooltip(token.actor, saveType, rollResult, d20, modifier);

            const rawDosValue = getUnadjustedDos(rollResult.total, saveDC, d20);
            const finalDosValue = rollResult.degreeOfSuccess ?? rollResult.options?.degreeOfSuccess;

            const dosMap = { 0: "criticalFailure", 1: "failure", 2: "success", 3: "criticalSuccess" };
            let dos = finalDosValue !== undefined ? dosMap[finalDosValue] : "success";
            let unadjustedDos = rawDosValue !== undefined ? dosMap[rawDosValue] : dos;
            
            updateData[`flags.${MODULE_ID}.targets.${tokenId}`] = {
                hasRolled: true, rollTotal: rollResult.total, rollFormula: rollResult.formula,
                rollTooltip: rollTooltip, degreeOfSuccess: dos, unadjustedDegreeOfSuccess: unadjustedDos
            };
        }
        
        if (Object.keys(updateData).length > 0) {
            await message.update(updateData);
            const freshMessage = game.messages.get(message.id);
            const freshAoeData = freshMessage.flags[MODULE_ID];
            const templatePath = `modules/${MODULE_ID}/templates/chat-card.hbs`;
            const formattedSaveType = saveType.charAt(0).toUpperCase() + saveType.slice(1);
            
            const newHtmlContent = await renderHBS(templatePath, { 
                targets: formatTargetsData(freshAoeData.targets), itemName: freshAoeData.itemName,
                saveType: formattedSaveType, saveDC: saveDC, damageTotal: freshAoeData.damageTotal,
                damageBreakdown: freshAoeData.damageBreakdown, damageFormula: freshAoeData.damageFormula, isGM: game.user.isGM
            });
            await freshMessage.update({ content: newHtmlContent });
        }
    });

    $html.find(".roll-save-btn").off("click").on("click", async (event) => {
        event.preventDefault();
        const tokenId = event.currentTarget.dataset.tokenId;
        const token = canvas.tokens.get(tokenId);
        if (!token || !token.actor) return;

        const aoeData = message.flags[MODULE_ID] || {};
        const saveType = aoeData.saveType || "reflex";
        const saveDC = aoeData.saveDC;

        let originItem = null;
        if (aoeData.originMessageId) {
            const originMsg = game.messages.get(aoeData.originMessageId);
            if (originMsg) originItem = originMsg.item;
        }
        if (!originItem && aoeData.itemUuid) { 
            try { originItem = await fromUuid(aoeData.itemUuid); } catch(e) {} 
        }
        
        const hasDamage = aoeData.hazardDamage || (originItem?.system?.damage && Object.keys(originItem.system.damage).length > 0);

        const rollOptions = { event: event, createMessage: false, extraRollOptions: [] };
        if (saveDC) rollOptions.dc = { value: saveDC };
        if (saveType === "reflex") {
            rollOptions.extraRollOptions.push("area-effect");
            if (hasDamage) rollOptions.extraRollOptions.push("damaging-effect");
        }
        
        const rollResult = await token.actor.saves[saveType].roll(rollOptions);
        if (!rollResult) return;
    
        if (game.dice3d) await game.dice3d.showForRoll(rollResult, game.user, true);

        let d20 = 10;
        const d20Term = rollResult.terms?.find(t => t.faces === 20);
        if (d20Term) d20 = d20Term.results?.[0]?.result ?? d20Term.total ?? 10;
        else if (rollResult.dice?.[0]) d20 = rollResult.dice[0].results?.[0]?.result ?? rollResult.dice[0].total ?? 10;

        const modifier = rollResult.total - d20;
        const rollTooltip = buildRollTooltip(token.actor, saveType, rollResult, d20, modifier);

        const rawDosValue = getUnadjustedDos(rollResult.total, saveDC, d20);
        const finalDosValue = rollResult.degreeOfSuccess ?? rollResult.options?.degreeOfSuccess;

        const dosMap = { 0: "criticalFailure", 1: "failure", 2: "success", 3: "criticalSuccess" };
        let dos = finalDosValue !== undefined ? dosMap[finalDosValue] : "success";
        let unadjustedDos = rawDosValue !== undefined ? dosMap[rawDosValue] : dos;
    
        window.aoeEasyResolveRoute("updateSaveRoll", {
            messageId: message.id,
            tokenId: tokenId,
            rollTotal: rollResult.total,
            rollFormula: rollResult.formula,
            rollTooltip: rollTooltip,
            dos: dos,
            unadjustedDos: unadjustedDos,
            hasUsedHeroPoint: false,
            hasCover: false
        });
    });

    $html.find(".hero-point-btn").off("click").on("click", async (event) => {
        event.preventDefault();
        const tokenId = event.currentTarget.dataset.tokenId;
        const token = canvas.tokens.get(tokenId);
        
        if (!token || !token.actor || !token.actor.isOwner) return;

        const hpPath = token.actor.system.resources?.heroPoints;
        if (!hpPath || hpPath.value < 1) {
            return ui.notifications.warn(`AoE Easy Resolve | ${token.name} does not have any Hero Points left to spend!`);
        }

        await token.actor.update({ "system.resources.heroPoints.value": hpPath.value - 1 });
        ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor: token.actor }),
            flavor: `<strong>Heroic Reroll!</strong>`,
            content: `${token.name} taps into their heroic resolve and spends a Hero Point to reroll their save.`
        });

        const aoeData = message.flags[MODULE_ID] || {};
        const saveType = aoeData.saveType || "reflex";
        const saveDC = aoeData.saveDC;

        let originItem = null;
        if (aoeData.originMessageId) {
            const originMsg = game.messages.get(aoeData.originMessageId);
            if (originMsg) originItem = originMsg.item;
        }
        if (!originItem && aoeData.itemUuid) { 
            try { originItem = await fromUuid(aoeData.itemUuid); } catch(e) {} 
        }
        
        const hasDamage = aoeData.hazardDamage || (originItem?.system?.damage && Object.keys(originItem.system.damage).length > 0);

        const rollOptions = { event: event, createMessage: false };
        if (saveDC) rollOptions.dc = { value: saveDC };
        
        let extraTraits = ["fortune"];
        if (saveType === "reflex") {
            extraTraits.push("area-effect");
            if (hasDamage) extraTraits.push("damaging-effect");
        }
        rollOptions.extraRollOptions = extraTraits;
        
        const rollResult = await token.actor.saves[saveType].roll(rollOptions);
        if (!rollResult) return;
    
        if (game.dice3d) await game.dice3d.showForRoll(rollResult, game.user, true);

        let d20 = 10;
        const d20Term = rollResult.terms?.find(t => t.faces === 20);
        if (d20Term) d20 = d20Term.results?.[0]?.result ?? d20Term.total ?? 10;
        else if (rollResult.dice?.[0]) d20 = rollResult.dice[0].results?.[0]?.result ?? rollResult.dice[0].total ?? 10;

        const modifier = rollResult.total - d20;
        const rollTooltip = buildRollTooltip(token.actor, saveType, rollResult, d20, modifier);

        const rawDosValue = getUnadjustedDos(rollResult.total, saveDC, d20);
        const finalDosValue = rollResult.degreeOfSuccess ?? rollResult.options?.degreeOfSuccess;

        const dosMap = { 0: "criticalFailure", 1: "failure", 2: "success", 3: "criticalSuccess" };
        let dos = finalDosValue !== undefined ? dosMap[finalDosValue] : "success";
        let unadjustedDos = rawDosValue !== undefined ? dosMap[rawDosValue] : dos;
    
        if (game.user.isGM) {
            let updatePayload = { 
                hasRolled: true, rollTotal: rollResult.total, rollFormula: rollResult.formula, 
                rollTooltip: rollTooltip, degreeOfSuccess: dos, unadjustedDegreeOfSuccess: unadjustedDos, 
                hasUsedHeroPoint: true 
            };
            
            const updateKey = `flags.${MODULE_ID}.targets.${tokenId}`;
            await message.update({ [updateKey]: updatePayload });

            const freshMessage = game.messages.get(message.id);
            const freshAoeData = freshMessage.flags[MODULE_ID];
            const templatePath = `modules/${MODULE_ID}/templates/chat-card.hbs`;
            const formattedSaveType = saveType.charAt(0).toUpperCase() + saveType.slice(1);
            
            const newHtmlContent = await renderHBS(templatePath, { 
                targets: formatTargetsData(freshAoeData.targets), itemName: freshAoeData.itemName,
                saveType: formattedSaveType, saveDC: saveDC, damageTotal: freshAoeData.damageTotal,
                damageBreakdown: freshAoeData.damageBreakdown, damageFormula: freshAoeData.damageFormula, 
                damageTooltip: freshAoeData.damageTooltip, isGM: game.user.isGM
            });
            await freshMessage.update({ content: newHtmlContent });
        } else {
            window.aoeEasyResolveRoute("updateSaveRoll", {
                messageId: message.id,
                tokenId: tokenId,
                rollTotal: rollResult.total,
                rollFormula: rollResult.formula,
                rollTooltip: rollTooltip,
                dos: dos,
                unadjustedDos: unadjustedDos,
                hasUsedHeroPoint: true,
                hasCover: false
            });
        }
    });

    // --- RETROACTIVE COVER INJECTION & HANDLER ---
    if (aoeData.saveType === "reflex") {
        $html.find(".hero-point-btn").each((idx, el) => {
            const tokenId = el.dataset.tokenId;
            const targetData = aoeData.targets[tokenId];
            if (targetData && targetData.hasRolled) {
                const coverActive = targetData.hasCover ? "color: #fff; background: #3498db; border-color: #3498db;" : "color: #7a7971; background: rgba(0,0,0,0.1); border: 1px solid #7a7971;";
                const coverHtml = `<button type="button" class="er-cover-btn" data-token-id="${tokenId}" title="Toggle Take Cover (+2)" style="flex: 0 0 30px; margin-left: 4px; ${coverActive}"><i class="fas fa-shield-alt"></i></button>`;
                if ($(el).siblings('.er-cover-btn').length === 0) {
                    $(el).after(coverHtml);
                }
            }
        });
    }

    $html.find(".er-cover-btn").off("click").on("click", async (event) => {
        event.preventDefault();
        const tokenId = event.currentTarget.dataset.tokenId;
        const token = canvas.tokens.get(tokenId);

        if (!game.user.isGM && (!token || !token.actor?.isOwner)) return;

        const freshMessage = game.messages.get(message.id);
        const aoeData = freshMessage.flags[MODULE_ID];
        const targetData = aoeData.targets[tokenId];

        if (!targetData || !targetData.hasRolled) return;

        const isApplyingCover = !targetData.hasCover;
        const modifier = isApplyingCover ? 2 : -2;
        const newTotal = targetData.rollTotal + modifier;

        const match = targetData.rollTooltip.match(/d20:\s*(\d+)/);
        const d20 = match ? parseInt(match[1], 10) : 10;

        const rawDosValue = getUnadjustedDos(newTotal, aoeData.saveDC, d20);
        const dosMap = { 0: "criticalFailure", 1: "failure", 2: "success", 3: "criticalSuccess" };
        const newDos = dosMap[rawDosValue] || "success";

        let newTooltip = targetData.rollTooltip;
        if (isApplyingCover) newTooltip += ", Take Cover (+2)";
        else newTooltip = newTooltip.replace(", Take Cover (+2)", "");

        if (game.user.isGM) {
            await freshMessage.update({ 
                [`flags.${MODULE_ID}.targets.${tokenId}.hasCover`]: isApplyingCover,
                [`flags.${MODULE_ID}.targets.${tokenId}.rollTotal`]: newTotal,
                [`flags.${MODULE_ID}.targets.${tokenId}.degreeOfSuccess`]: newDos,
                [`flags.${MODULE_ID}.targets.${tokenId}.unadjustedDegreeOfSuccess`]: newDos,
                [`flags.${MODULE_ID}.targets.${tokenId}.rollTooltip`]: newTooltip
            });

            const updatedMessage = game.messages.get(message.id);
            const updatedAoeData = updatedMessage.flags[MODULE_ID];
            const templatePath = `modules/${MODULE_ID}/templates/chat-card.hbs`;
            const formattedSaveType = updatedAoeData.saveType.charAt(0).toUpperCase() + updatedAoeData.saveType.slice(1);
            
            const newHtmlContent = await renderHBS(templatePath, { 
                targets: formatTargetsData(updatedAoeData.targets), itemName: updatedAoeData.itemName,
                saveType: formattedSaveType, saveDC: updatedAoeData.saveDC, damageTotal: updatedAoeData.damageTotal,
                damageBreakdown: updatedAoeData.damageBreakdown, damageFormula: updatedAoeData.damageFormula, 
                damageTooltip: updatedAoeData.damageTooltip, isGM: game.user.isGM
            });
            await updatedMessage.update({ content: newHtmlContent });
        } else {
            window.aoeEasyResolveRoute("updateSaveRoll", {
                messageId: message.id, 
                tokenId: tokenId, 
                rollTotal: newTotal, 
                rollFormula: targetData.rollFormula, 
                rollTooltip: newTooltip, 
                dos: newDos, 
                unadjustedDos: newDos, 
                hasUsedHeroPoint: targetData.hasUsedHeroPoint, 
                hasCover: isApplyingCover 
            });
        }
    });

    $html.find(".step-dos-btn").off("click").on("click", async (event) => {
        event.preventDefault();
        if (!game.user.isGM) return; 

        const tokenId = event.currentTarget.dataset.tokenId;
        const direction = event.currentTarget.dataset.direction;
        
        const freshMessage = game.messages.get(message.id);
        const aoeData = freshMessage.flags[MODULE_ID];
        const targetData = aoeData.targets[tokenId];
        
        if (!targetData || !targetData.hasRolled) return;

        const dosOrder = ["criticalFailure", "failure", "success", "criticalSuccess"];
        let currentIndex = dosOrder.indexOf(targetData.degreeOfSuccess);
        if (currentIndex === -1) currentIndex = 1; 

        if (direction === "up" && currentIndex < 3) currentIndex++;
        else if (direction === "down" && currentIndex > 0) currentIndex--;
        else return; 

        const newDos = dosOrder[currentIndex];

        window.aoeEasyResolveRoute("updateSaveRoll", {
            messageId: message.id,
            tokenId: tokenId,
            rollTotal: targetData.rollTotal,
            rollFormula: targetData.rollFormula,
            rollTooltip: targetData.rollTooltip,
            dos: newDos,
            unadjustedDos: targetData.unadjustedDegreeOfSuccess,
            hasUsedHeroPoint: targetData.hasUsedHeroPoint,
            hasCover: targetData.hasCover
        });
    });

    $html.find(".apply-damage-btn").off("click").on("click", async (event) => {
        event.preventDefault();
        
        const $btn = $(event.currentTarget);
        if ($btn.prop("disabled")) return;
        $btn.prop("disabled", true).html('<i class="fas fa-spinner fa-spin"></i> Processing...');

        const freshMessage = game.messages.get(message.id);
        const aoeData = freshMessage.flags[MODULE_ID];
        
        if (!aoeData || !aoeData.targets) {
            $btn.prop("disabled", false).html('<i class="fas fa-heart-broken"></i> Apply Damage & Effects');
            return;
        }

        const pf2eDamageClass = CONFIG.Dice.rolls.find(r => r.name === "DamageRoll") || Roll;
        let pf2eDamageRoll = null;
        if (aoeData.damageJSON) {
            try { 
                pf2eDamageRoll = pf2eDamageClass.fromJSON(aoeData.damageJSON); 
            } catch (e) { 
                console.error("AoE Easy Resolve | Failed to parse DamageRoll JSON.", e); 
            }
        }

        let originItem = null;
        if (aoeData.originMessageId) {
            const originMsg = game.messages.get(aoeData.originMessageId);
            if (originMsg) originItem = originMsg.item;
        }
        if (!originItem && aoeData.itemUuid) { 
            try { originItem = await fromUuid(aoeData.itemUuid); } catch(e) {} 
        }

        const aoeFlags = originItem?.flags?.[MODULE_ID] || {};
        const itemMultipliers = aoeFlags.multipliers || {};
        let processedCount = 0;

        const itemHasDamage = (originItem?.system?.damage && Object.keys(originItem.system.damage).length > 0) || 
                              (aoeFlags.useCustomDamage && aoeFlags.baseDamage) || 
                              aoeData.hazardDamage;
        
        if (itemHasDamage && (aoeData.damageTotal === undefined || aoeData.damageTotal === null)) {
            $btn.prop("disabled", false).html('<i class="fas fa-heart-broken"></i> Apply Damage & Effects');
            return ui.notifications.warn("AoE Easy Resolve | You must roll damage before applying effects!");
        }

        let msgUpdates = {};
        window.aoeEasyResolveApplying = { isApplying: true, receipt: [] };

        try {
            let applyPayload = { targets: aoeData.targets, originItem: originItem, damageTotal: aoeData.damageTotal, messageId: message.id };
            applyPayload = await game.modules.get(MODULE_ID).api.runInterceptors("preApplyDamage", applyPayload);

            for (const [tokenId, targetData] of Object.entries(applyPayload.targets)) {
                try {
                    const token = canvas.tokens.get(tokenId);
                    if (!token || !token.actor) continue;
                    if (targetData.hasApplied) continue; 

                    window.aoeEasyResolveApplying.activeSaveNote = ""; 
                    window.aoeEasyResolveApplying.activeTokenId = tokenId;

                    const negativeHealing = token.actor.system.attributes.hp?.negativeHealing || false;
                    const itemTraits = originItem?.system?.traits?.value || [];
                    let isVitality = itemTraits.includes("vitality") || itemTraits.includes("positive");
                    let isVoid = itemTraits.includes("void") || itemTraits.includes("negative");
                    const isHealingTrait = itemTraits.includes("healing");

                    const cardItemName = aoeData.itemName || originItem?.name || "";
                    const isBomb = cardItemName.includes("Necrotic Bomb") || cardItemName.includes("Necrotic Blast");
                    const isHarm = cardItemName === "Harm" || cardItemName.includes("Harm");

                    if (isBomb) {
                        const targetType = message.getFlag("necromancer-thrall-helper", `dmgType_${tokenId}`) || "void";
                        isVitality = (targetType === "vitality");
                        isVoid = (targetType === "void");
                    }

                    let effectType = "standard";
                    let overrideType = null;

                    if (isBomb) {
                        if (isVitality) {
                            effectType = negativeHealing ? "damage" : "none";
                            overrideType = "vitality";
                        } else if (isVoid) {
                            effectType = negativeHealing ? "none" : "damage";
                            overrideType = "void";
                        }
                    } else if (isHarm) {
                        const harmState = message.getFlag("necromancer-thrall-helper", `harmState_${tokenId}`) || "void";
                        if (harmState === "vit") {
                            effectType = negativeHealing ? "damage" : "none";
                            overrideType = "vitality";
                        } else if (harmState === "heal") {
                            effectType = "heal";
                            overrideType = negativeHealing ? "void" : "vitality";
                        } else {
                            effectType = negativeHealing ? "heal" : "damage";
                            overrideType = "void";
                        }
                    } else {
                        if (isHealingTrait) {
                            if (isVitality) { effectType = negativeHealing ? "damage" : "heal"; overrideType = "vitality"; }
                            else if (isVoid) { effectType = negativeHealing ? "heal" : "damage"; overrideType = "void"; }
                            else { effectType = negativeHealing ? "none" : "heal"; }
                        } else {
                            if (isVitality) { effectType = negativeHealing ? "damage" : "none"; overrideType = "vitality"; } 
                            else if (isVoid) { effectType = negativeHealing ? "none" : "damage"; overrideType = "void"; }
                        }
                    }

                    if (effectType === "standard" && pf2eDamageRoll && pf2eDamageRoll.instances?.some(i => i.type === "healing")) effectType = negativeHealing ? "none" : "heal";

                    const targetAlliance = token.actor?.alliance;
                    const casterAlliance = originItem?.actor?.alliance || "party";
                    const isAlly = targetAlliance === casterAlliance;
                    const forcedEffect = isAlly ? aoeFlags.allyBaseEffect : aoeFlags.enemyBaseEffect;
                    
                    if (forcedEffect === "heal") effectType = "heal";
                    if (forcedEffect === "immune") effectType = "none";

                    if (effectType === "none") { 
                        window.aoeEasyResolveApplying.receipt.push({
                            tokenId: tokenId, speaker: { alias: token.name }, img: token.document?.texture?.src || "icons/svg/mystery-man.svg",
                            content: `<span style="font-weight: bold; color: #888;">Immune. Takes no damage.</span>`, saveNote: "Target is Immune",
                            forensics: { valueTotal: 0, isHealing: false, mitigatedTotal: 0, isKill: false }
                        });
                        processedCount++; 
                        msgUpdates[`flags.${MODULE_ID}.targets.${tokenId}.hasApplied`] = true; 
                        continue; 
                    }

                    const isHealEffect = effectType === "heal";
                    if (!targetData.hasRolled && !isHealEffect) continue;

                    const dos = targetData.degreeOfSuccess || "failure"; 

                    if (targetData.hasRolled) {
                        Hooks.callAll('holodeckAoeSave', { targetDoc: token.actor, targetName: token.name, outcome: dos });
                    }

                    if (aoeData.damageTotal !== undefined && aoeData.damageTotal !== null) {
                        let multiplier = 0;
                        if (isHealEffect) {
                            multiplier = 1; 
                        } else {
                            const customVal = itemMultipliers[dos];
                            if (customVal !== undefined && customVal !== null && customVal.toString().trim() !== "") {
                                multiplier = parseFloat(customVal);
                            } else {
                                const isBasic = aoeData.isBasicSave !== false;
                                if (isBasic) {
                                    if (dos === "criticalFailure") multiplier = 2;
                                    else if (dos === "failure") multiplier = 1;
                                    else if (dos === "success") multiplier = 0.5;
                                    else if (dos === "criticalSuccess") multiplier = 0;
                                } else {
                                    if (dos === "criticalFailure" || dos === "failure") multiplier = 1;
                                }
                            }
                        }

                        if (!isHealEffect) {
                            const dosMap = { "criticalSuccess": "Crit Success", "success": "Success", "failure": "Failure", "criticalFailure": "Crit Failure" };
                            window.aoeEasyResolveApplying.activeSaveNote = `Save Mitigation: ${dosMap[dos] || dos} (x${multiplier})`;
                        }

                        if (multiplier > 0) {
                            if (isHealEffect) {
                                const healAmount = aoeData.damageTotal;
                                const currentHP = token.actor.system.attributes.hp.value;
                                const maxHP = token.actor.system.attributes.hp.max;
                                const actualHealed = Math.min(maxHP - currentHP, healAmount);
                                
                                await token.actor.update({ "system.attributes.hp.value": currentHP + actualHealed });

                                try {
                                    if (canvas.ready && actualHealed > 0) {
                                        canvas.interface.createScrollingText(token.center, `+${actualHealed}`, { anchor: CONST.TEXT_ANCHOR_POINTS.TOP, fill: 0x4ade80, direction: CONST.TEXT_ANCHOR_POINTS.UP });
                                    }
                                } catch (err) {}
                                
                                window.aoeEasyResolveApplying.receipt.push({
                                    tokenId: tokenId, speaker: { alias: token.name }, img: token.document.texture.src,
                                    content: `<span style="color: #4ade80; font-weight: bold; text-shadow: 1px 1px 2px black;">Recovered ${actualHealed} HP</span>`, saveNote: "Healing Applied",
                                    forensics: { valueTotal: actualHealed, isHealing: true, mitigatedTotal: 0, isKill: false }
                                });

                            } else {
                                let damageToApply = null;
                                let appliedPersistent = [];

                                if (pf2eDamageRoll) {
                                    try {
                                        let formulaParts = [];
                                        if (pf2eDamageRoll.instances) {
                                            for (const inst of pf2eDamageRoll.instances) {
                                                const isPersistent = inst.persistent || inst.category === "persistent" || inst.options?.has?.("persistent") || inst.options?.includes?.("persistent");
                                                const flavor = overrideType || inst.type || "untyped";

                                                if (isPersistent) {
                                                    if (multiplier > 0) {
                                                        let pFormula = inst.head?.expression || inst.total?.toString() || "0";
                                                        if (multiplier !== 1) pFormula = `(${pFormula}) * ${multiplier}`;
                                                        appliedPersistent.push({ formula: pFormula, type: flavor });
                                                    }
                                                } else {
                                                    const baseTotal = inst.total !== undefined ? inst.total : (aoeData.damageTotal || 0);
                                                    const scaled = Math.floor(baseTotal * multiplier);
                                                    formulaParts.push(`${scaled}[${flavor}]`);
                                                }
                                            }
                                        }
                                        if (formulaParts.length > 0) {
                                            damageToApply = await new pf2eDamageClass(formulaParts.join(", ")).evaluate();
                                        }
                                    } catch (e) { 
                                        console.warn("AoE Easy Resolve | Failed to rebuild scaled DamageRoll.", e); 
                                    }
                                } 
                                
                                if (!damageToApply) {
                                    const fallbackTotal = Math.floor((aoeData.damageTotal || 0) * multiplier);
                                    const fallbackFlavor = overrideType || "untyped";
                                    damageToApply = await new pf2eDamageClass(`${fallbackTotal}[${fallbackFlavor}]`).evaluate();
                                }

                                const immediateTotal = damageToApply.total || 0;
                                
                                if (!damageToApply) {
                                    const fallbackTotal = Math.floor((aoeData.damageTotal || 0) * multiplier);
                                    const fallbackFlavor = overrideType || "untyped";
                                    damageToApply = await new pf2eDamageClass(`${fallbackTotal}[${fallbackFlavor}]`).evaluate({async: true});
                                }

                                if (immediateTotal > 0 || (immediateTotal === 0 && appliedPersistent.length === 0)) {
                                    let extraTraits = new Set();
                                    if (aoeData.templateId || aoeFlags.isAreaDamage) {
                                        extraTraits.add("area-damage"); 
                                        extraTraits.add("area-effect"); 
                                    }
                                    if (itemHasDamage) extraTraits.add("damaging-effect");

                                    try {
                                        if (token.actor.applyDamage) {
                                            await token.actor.applyDamage({ damage: damageToApply, token: token.document, item: originItem, rollOptions: extraTraits });
                                        } else { 
                                            throw new Error("PF2e applyDamage API not found on actor."); 
                                        }
                                    } catch (error) {
                                        console.warn(`AoE Easy Resolve | Native applyDamage failed for ${token.name}. Using raw HP fallback.`, error);
                                        try {
                                            const currentHP = token.actor.system.attributes.hp.value;
                                            await token.actor.update({ "system.attributes.hp.value": Math.max(0, currentHP - immediateTotal) });
                                            
                                            window.aoeEasyResolveApplying.receipt.push({
                                                tokenId: tokenId,
                                                speaker: { alias: token.name },
                                                img: token.document?.texture?.src || "icons/svg/mystery-man.svg",
                                                content: `<span style="color: #ff8c00; font-weight: bold;">Took ${immediateTotal} Damage (Fallback)</span>`,
                                                saveNote: window.aoeEasyResolveApplying.activeSaveNote,
                                                forensics: { valueTotal: immediateTotal, isHealing: false, mitigatedTotal: 0, isKill: false }
                                            });
                                        } catch (fallbackError) { }
                                    }
                                }

                                if (appliedPersistent.length > 0) {
                                    for (const p of appliedPersistent) {
                                        try {
                                            const baseCondition = game.pf2e.ConditionManager.getCondition("persistent-damage").toObject();
                                            baseCondition.system.persistent = { formula: p.formula, damageType: p.type, dc: 15 };
                                            await token.actor.createEmbeddedDocuments("Item", [baseCondition]);
                                        } catch (err) { }
                                    }

                                    const pStrings = appliedPersistent.map(p => `${p.formula} ${p.type}`);
                                    if (immediateTotal > 0 && window.aoeEasyResolveApplying.receipt.length > 0) {
                                        const lastEntry = window.aoeEasyResolveApplying.receipt[window.aoeEasyResolveApplying.receipt.length - 1];
                                        if (lastEntry.tokenId === tokenId) lastEntry.saveNote += `<br><span style="color:#ff6b6b">Persistent:</span> ${pStrings.join(", ")}`;
                                    } else if (immediateTotal === 0) {
                                        window.aoeEasyResolveApplying.receipt.push({
                                            tokenId: tokenId, speaker: { alias: token.name }, img: token.document?.texture?.src || "icons/svg/mystery-man.svg",
                                            content: `<span style="font-weight: bold; color: #ff6b6b;">Takes Persistent Damage</span>`,
                                            saveNote: `${window.aoeEasyResolveApplying.activeSaveNote}<br><span style="color:#ff6b6b">Persistent:</span> ${pStrings.join(", ")}`,
                                            forensics: { valueTotal: immediateTotal, isHealing: false, mitigatedTotal: 0, isKill: false }
                                        });
                                    }
                                }
                            }
                        } else {
                            window.aoeEasyResolveApplying.receipt.push({
                                tokenId: tokenId, speaker: { alias: token.name }, img: token.document?.texture?.src || "icons/svg/mystery-man.svg",
                                content: `<span style="font-weight: bold; color: #888;">Takes no damage.</span>`, saveNote: window.aoeEasyResolveApplying.activeSaveNote || "Complete Mitigation",
                                forensics: { valueTotal: 0, isHealing: false, mitigatedTotal: 0, isKill: false }
                            });
                        }
                    }

                    const saveContext = aoeData.isReactive ? "reactiveSave" : "save";
                    await executeEffectRules([token], saveContext, dos, originItem, message.actor);
                    
                    processedCount++; 
                    msgUpdates[`flags.${MODULE_ID}.targets.${tokenId}.hasApplied`] = true;
                    
                } catch (targetErr) {
                    console.error(`AoE Easy Resolve | Network latency interrupted target ${tokenId}. Skipping to next.`, targetErr);
                }
            }
        } catch (fatalErr) {
            console.error("AoE Easy Resolve | Fatal error during Apply loop.", fatalErr);
        } finally {
            const receiptList = window.aoeEasyResolveApplying.receipt;
            window.aoeEasyResolveApplying = null;

            if (receiptList.length > 0) {
                const title = originItem ? originItem.name : "Effect Resolution";
                const totalDmg = aoeData.damageTotal;
                const dmgBreakdown = aoeData.damageBreakdown;
                
                let headerExtra = "";
                if (totalDmg !== undefined && totalDmg !== null) {
                    const baseTooltip = (aoeData.damageTooltip || "Base Damage Roll").replace(/"/g, '&quot;');
                    headerExtra = `<div data-tooltip="${baseTooltip}" data-tooltip-direction="UP" style="margin-top: 4px; font-size: 1.1em; color: #ff6b6b; font-weight: bold; text-shadow: 1px 1px 2px black; cursor: help;">Base Roll: ${dmgBreakdown || totalDmg} <i class="fas fa-info-circle" style="font-size: 0.8em; color: #7a7971;"></i></div>`;
                }
                
                let receiptHtml = `<div class="aoe-easy-resolve-card">
                    <header style="text-align: center; margin-bottom: 10px; border-bottom: 2px solid #333; padding-bottom: 5px;">
                        <h2 style="margin: 0; font-size: 1.5em;">${title}</h2>
                        <div style="font-weight: bold; font-size: 1em; color: #888;">Resolution Summary</div>
                        ${headerExtra}
                    </header>
                    <div class="targets-section" style="display: flex; flex-direction: column; gap: 4px;">`;

                for (let entry of receiptList) {
                    const tokenName = entry.speaker?.alias || "Target";
                    const tokenImg = entry.img || "icons/svg/mystery-man.svg";
                    
                    const targetData = aoeData.targets[entry.tokenId];
                    let rowBg = "rgba(0, 0, 0, 0.2)"; 
                    
                    if (targetData) {
                        if (targetData.isHealing) {
                            rowBg = "rgba(46, 204, 113, 0.15)"; 
                        } else {
                            const dos = targetData.degreeOfSuccess;
                            if (dos === "criticalSuccess") rowBg = "rgba(212, 175, 55, 0.15)";
                            else if (dos === "success") rowBg = "rgba(52, 152, 219, 0.15)"; 
                            else if (dos === "failure") rowBg =  "rgba(0, 0, 0, 0.4)"; 
                            else if (dos === "criticalFailure") rowBg = "rgba(231, 76, 60, 0.15)";
                        }
                    }

                    let forensicTooltip = `<strong>Base Roll:</strong> ${totalDmg}`;
                    if (entry.saveNote) forensicTooltip += `<br><strong>${entry.saveNote}</strong>`;

                    if (entry.iwr && entry.iwr.length > 0) {
                        entry.iwr.forEach(note => {
                            forensicTooltip += `<br><span style='color:#ff6b6b'>IWR:</span> ${note}`;
                        });
                    }

                    const safeTooltip = forensicTooltip.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
                  let cleanContent = (entry.flavor || "") + " " + (entry.content || "");
                  
                  cleanContent = cleanContent.replace(/<button[\s\S]*?<\/button>/gi, "");
                  cleanContent = cleanContent.replace(/<span class="transparent"[\s\S]*?<\/span>/gi, "");
                  cleanContent = cleanContent.replace(/<span class="statement"[\s\S]*?<\/span>/gi, "");
                  
                  const escapedName = tokenName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                  cleanContent = cleanContent.replace(new RegExp(escapedName, "i"), "");
                  cleanContent = cleanContent.replace(/<(strong|b|span|div)[^>]*>\s*<\/\1>/gi, "");
                  cleanContent = cleanContent.replace(/^(<[^>]+>|\s)*('s)?\s*takes\s+/i, "$1");
                  cleanContent = cleanContent.replace(/(>|^)\s*([a-z])/i, (match, p1, p2) => p1 + p2.toUpperCase());
                  
                  cleanContent = cleanContent.trim();

                  const finalContent = `<div style="display: flex; flex-direction: column; align-items: flex-end; width: 100%;">
                      <div style="display: flex; align-items: center; gap: 6px; justify-content: flex-end; width: 100%; margin-bottom: 3px;">
                          <span style="font-weight: 500; text-shadow: 1px 1px 1px rgba(0,0,0,0.4);">${cleanContent}</span>
                          <i class="fas fa-info-circle" data-tooltip="${safeTooltip}" data-tooltip-direction="LEFT" style="color: #7a7971; font-size: 0.95em; cursor: help; flex-shrink: 0;"></i>
                      </div>
                      ${entry.appliedConditions && entry.appliedConditions.length > 0 ? `<div style="display: flex; flex-wrap: wrap; gap: 4px; justify-content: flex-end;">${entry.appliedConditions.join("")}</div>` : ""}
                  </div>`;

                   receiptHtml += `<div class="target-row" data-token-id="${entry.tokenId}" style="display: flex; align-items: center; justify-content: space-between; background: ${rowBg}; padding: 4px 6px; border-radius: 4px;">
                        <div style="display: flex; align-items: center; gap: 8px; width: 45%; flex-shrink: 0; padding-right: 6px; border-right: 1px solid rgba(255,255,255,0.1);">
                            <img src="${tokenImg}" width="28" height="28" style="border: none; border-radius: 4px; flex-shrink: 0; object-fit: cover; background: rgba(0,0,0,0.3);" />
                            <span style="font-weight: bold; line-height: 1.1; word-wrap: break-word;" title="${tokenName}">${tokenName}</span>
                        </div>
                        <div class="receipt-content-wrapper" style="font-size: 0.95em; line-height: 1.2; flex: 1; text-align: right; display: flex; align-items: center; justify-content: flex-end; gap: 6px; padding-left: 6px;">
                            ${finalContent}
                        </div>
                    </div>`;
                }
                receiptHtml += `</div></div>`;

                let parserData = receiptList.map(entry => {
                    return {
                        tokenId: entry.tokenId,
                        targetName: entry.speaker?.alias || "Unknown",
                        valueTotal: entry.forensics?.valueTotal || 0,
                        isHealing: entry.forensics?.isHealing || false,
                        mitigatedTotal: entry.forensics?.mitigatedTotal || 0,
                        isKill: entry.forensics?.isKill || false
                    };
                });

                await ChatMessage.create({
                    speaker: ChatMessage.getSpeaker(),
                    content: receiptHtml,
                    flags: {
                        [MODULE_ID]: {
                            isResolutionSummary: true,
                            actionName: title,
                            origin: originItem ? originItem.uuid : null,
                            parsedResults: parserData
                        }
                    }
                });
            }
        }
        
        if (Object.keys(msgUpdates).length > 0) {
            await freshMessage.update(msgUpdates);
            
            const updatedMessage = game.messages.get(freshMessage.id);
            const updatedAoeData = updatedMessage.flags[MODULE_ID];
            const templatePath = `modules/${MODULE_ID}/templates/chat-card.hbs`;
            const formattedSaveType = updatedAoeData.saveType.charAt(0).toUpperCase() + updatedAoeData.saveType.slice(1);
            
            const newHtmlContent = await renderHBS(templatePath, { 
                targets: formatTargetsData(updatedAoeData.targets), itemName: updatedAoeData.itemName,
                saveType: formattedSaveType, saveDC: updatedAoeData.saveDC, damageTotal: updatedAoeData.damageTotal,
                damageBreakdown: updatedAoeData.damageBreakdown, damageFormula: updatedAoeData.damageFormula, damageTooltip: updatedAoeData.damageTooltip, isGM: game.user.isGM
            });
            await updatedMessage.update({ content: newHtmlContent });
        } else {
            $btn.prop("disabled", false).html('<i class="fas fa-heart-broken"></i> Apply Damage & Effects');
        }

        if (processedCount > 0) {
            ui.notifications.info(`AoE Easy Resolve | Processed damage and effects for ${processedCount} targets.`);
        } else {
            ui.notifications.warn("AoE Easy Resolve | All valid targets have already been processed.");
        }

        if (game.user.isGM && aoeData.templateId) {
            let boardDoc = canvas.scene.templates?.get(aoeData.templateId) || canvas.scene.regions?.get(aoeData.templateId);
            
            const hasDuration = !!aoeData.hazardDuration;
            const hasTerrain = aoeFlags.terrainEffect === "difficult" || aoeFlags.terrainEffect === "greater";
            const hasPersistentRules = aoeFlags.rules && Object.values(aoeFlags.rules).some(r => ["tokenEnter", "tokenExit", "tokenMove", "turnStart", "turnEnd"].includes(r.context));
            
            const shouldLinger = hasDuration || hasTerrain || hasPersistentRules;

            if (boardDoc && !shouldLinger) {
                const docName = boardDoc.documentName === "Region" ? "Region" : "Template";
                const deleteCb = async () => { 
                    try { await boardDoc.delete(); ui.notifications.info(`AoE Easy Resolve | ${docName} removed.`); } catch(e) { console.error(e); } 
                };

                if (foundry.applications?.api?.DialogV2) {
                   foundry.applications.api.DialogV2.confirm({
                       window: { title: `Remove ${docName}?` },
                       content: `<p>Do you want to remove the effect ${docName.toLowerCase()} from the canvas?</p>`,
                       yes: { callback: deleteCb }
                   });
                } else {
                   new Dialog({
                     title: `Remove ${docName}?`, content: `<p>Do you want to remove the effect ${docName.toLowerCase()} from the canvas?</p>`,
                     buttons: {
                       yes: { icon: '<i class="fas fa-trash"></i>', label: "Yes", callback: deleteCb },
                       no: { icon: '<i class="fas fa-times"></i>', label: "No" }
                     }, default: "yes"
                   }).render(true);
                }
            }
        }
    });
});

async function createVisualGhost(scene, regionDoc, color) {
    if (regionDoc.getFlag(MODULE_ID, "ghostDrawingIds")) return;

    const drawingDocs = [];
    const shapes = Array.from(regionDoc.shapes || []);

    for (let shape of shapes) {
        let drawingData = {
            author: game.user.id,
            fillType: 1, 
            fillColor: color || game.user.color || "#ff0000",
            fillAlpha: 0.25,
            strokeWidth: 2,
            strokeColor: color || game.user.color || "#ff0000",
            strokeAlpha: 0.8,
            hidden: false,
            flags: { [MODULE_ID]: { isGhost: true, regionId: regionDoc.id } }
        };

        let sType = shape.type;
        if (sType === "ellipse") {
            drawingData.shape = { type: "e", width: shape.radiusX * 2, height: shape.radiusY * 2 };
            drawingData.x = shape.x - shape.radiusX;
            drawingData.y = shape.y - shape.radiusY;
        } else if (sType === "polygon") {
            const pts = shape.points;
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (let i = 0; i < pts.length; i += 2) {
                if(pts[i] < minX) minX = pts[i];
                if(pts[i] > maxX) maxX = pts[i];
                if(pts[i+1] < minY) minY = pts[i+1];
                if(pts[i+1] > maxY) maxY = pts[i+1];
            }
            const relPoints = [];
            for (let i = 0; i < pts.length; i += 2) {
                relPoints.push(pts[i] - minX, pts[i+1] - minY);
            }
            drawingData.shape = { type: "p", points: relPoints, width: maxX - minX, height: maxY - minY };
            drawingData.x = minX;
            drawingData.y = minY;
        } else if (sType === "rectangle") {
            drawingData.shape = { type: "r", width: shape.width, height: shape.height };
            drawingData.x = shape.x;
            drawingData.y = shape.y;
        }

        if (drawingData.shape) drawingDocs.push(drawingData);
    }

    if (drawingDocs.length > 0) {
        const drawings = await scene.createEmbeddedDocuments("Drawing", drawingDocs);
        const drawingIds = drawings.map(d => d.id);
        await regionDoc.update({ [`flags.${MODULE_ID}.ghostDrawingIds`]: drawingIds });
    }
}

// --- VISUAL BURST GENERATOR (Bubbly Pixie Dust - Extended Life) ---
async function createVisualBurst(doc, colorHex) {
    let x = 0;
    let y = 0;
    let radiusPixels = 100;

    const placeable = doc.object;
    if (placeable && placeable.center && placeable.bounds) {
        x = placeable.center.x;
        y = placeable.center.y;
        radiusPixels = Math.max(placeable.bounds.width, placeable.bounds.height) / 2;
    } else {
        x = doc.x ?? 0;
        y = doc.y ?? 0;
        if (doc.documentName === "MeasuredTemplate") {
            const dist = doc.distance || 15;
            radiusPixels = (dist / canvas.dimensions.distance) * canvas.dimensions.size;
        } else if (doc.documentName === "Region" && doc.shapes?.length > 0) {
            const s = doc.shapes[0];
            x = s.x ?? x;
            y = s.y ?? y;
            radiusPixels = s.radiusX ?? s.radius ?? 150;
            
            if (s.points && s.points.length > 0) {
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                for(let i=0; i<s.points.length; i+=2) {
                    minX = Math.min(minX, s.points[i]); maxX = Math.max(maxX, s.points[i]);
                    minY = Math.min(minY, s.points[i+1]); maxY = Math.max(maxY, s.points[i+1]);
                }
                x = minX + (maxX - minX) / 2;
                y = minY + (maxY - minY) / 2;
                radiusPixels = Math.max(maxX - minX, maxY - minY) / 2;
            }
        }
    }

    if (x === undefined || isNaN(x) || y === undefined || isNaN(y)) return;

    try {
        let numericColor = 0x3498db; 
        if (colorHex) {
            const c = Color.from(colorHex);
            if (c && c.valid) numericColor = c.valueOf();
        }

        const container = new PIXI.Container();
        container.x = x;
        container.y = y;
        container.zIndex = 99999;
        
        if (canvas.interface) canvas.interface.addChild(container);
        else if (canvas.effects) canvas.effects.addChild(container);
        else canvas.stage.addChild(container);

        const particles = [];

        const createParticle = (isEdge) => {
            const p = new PIXI.Graphics();
            
            p.beginFill(numericColor, 0.6);
            p.lineStyle(1, numericColor, 1);
            
            const isChonky = Math.random() > 0.8;
            const size = isChonky ? Math.random() * 8 + 6 : Math.random() * 3 + 2; 
            p.drawCircle(0, 0, size);
            p.endFill();
            
            let angle = Math.random() * Math.PI * 2;
            let speed, px, py, vx, vy;
            let life = Math.random() * 120 + 180; 

            if (isEdge) {
                px = Math.cos(angle) * radiusPixels;
                py = Math.sin(angle) * radiusPixels;
                let tangent = angle + Math.PI / 2;
                speed = Math.random() * 1.5 + 0.5; 
                vx = Math.cos(tangent) * speed;
                vy = Math.sin(tangent) * speed;
            } else {
                px = (Math.random() - 0.5) * (radiusPixels * 0.4);
                py = (Math.random() - 0.5) * (radiusPixels * 0.4);
                speed = Math.random() * (radiusPixels / 25) + 0.5; 
                vx = Math.cos(angle) * speed;
                vy = Math.sin(angle) * speed;
            }

            p.x = px;
            p.y = py;
            
            container.addChild(p);
            return { gfx: p, vx, vy, life, maxLife: life };
        };

        for(let i=0; i<50; i++) particles.push(createParticle(true));
        for(let i=0; i<50; i++) particles.push(createParticle(false));

        const ring = new PIXI.Graphics();
        ring.lineStyle(4, numericColor, 0.8);
        ring.drawCircle(0, 0, radiusPixels);
        container.addChild(ring);
        let ringLife = 90; 

        const animateParticles = () => {
            let allDead = true;

            if (ringLife > 0) {
                ringLife--;
                ring.alpha = ringLife / 90;
                ring.scale.set(0.95 + (1 - ringLife/90) * 0.05); 
                allDead = false;
            }

            for (let i = particles.length - 1; i >= 0; i--) {
                let p = particles[i];
                if (p.life > 0) {
                    p.life--;
                    
                    p.gfx.x += p.vx;
                    p.gfx.y += p.vy;
                    
                    p.vx *= 0.98;
                    p.vy *= 0.98;

                    p.gfx.alpha = p.life / p.maxLife;
                    allDead = false;
                } else if (p.gfx.parent) {
                    p.gfx.parent.removeChild(p.gfx);
                    p.gfx.destroy();
                }
            }

            if (allDead) {
                canvas.app.ticker.remove(animateParticles);
                if (container.parent) container.parent.removeChild(container);
                container.destroy({children: true});
            }
        };

        canvas.app.ticker.add(animateParticles);

    } catch (e) {
        console.error("AoE Easy Resolve | Visual Burst failed:", e);
    }
}

// --- TEMPLATE CONVERSION ENGINE ---
async function generateTemplateCard(doc, cfg) {
    try {
        await new Promise(resolve => setTimeout(resolve, 300));

        const rules = Array.isArray(cfg.originItem?.flags?.[MODULE_ID]?.rules) ? cfg.originItem.flags[MODULE_ID].rules : Object.values(cfg.originItem?.flags?.[MODULE_ID]?.rules || {});
        const persistentRules = rules.filter(r => ["tokenEnter", "tokenExit", "tokenMove", "turnStart", "turnEnd"].includes(r.context));

        const subscribedEvents = persistentRules.length > 0 
            ? ["tokenEnter", "tokenExit", "tokenMove", "tokenMoveIn", "tokenMoveOut", "tokenMoveWithin", "tokenTurnStart", "tokenTurnEnd"] 
            : [];
            
        const terrainEffect = cfg.originItem?.flags?.[MODULE_ID]?.terrainEffect;
        const hasDuration = !!cfg.hazardDuration;
        const needsRegion = persistentRules.length > 0 || terrainEffect === "difficult" || terrainEffect === "greater" || hasDuration;

        if (doc && doc.documentName === "MeasuredTemplate" && needsRegion) {
            let regionShapes = [];
            const distance = doc.distance || 15;
            const pixels = (distance / canvas.dimensions.distance) * canvas.dimensions.size;
            
            if (doc.t === "circle") {
                regionShapes.push({ type: "ellipse", hole: false, x: doc.x, y: doc.y, radiusX: pixels, radiusY: pixels, rotation: 0 });
            } else if (doc.object?.shape?.points) {
                const pts = doc.object.shape.points;
                const globalPts = [];
                for (let i = 0; i < pts.length; i += 2) {
                    globalPts.push(pts[i] + doc.x, pts[i+1] + doc.y);
                }
                regionShapes.push({ type: "polygon", hole: false, points: globalPts });
            }

            if (regionShapes.length > 0) {
                let behaviors = [];

                if (subscribedEvents.length > 0) {
                    behaviors.push({
                        name: "AoE Easy Resolve Controller",
                        type: "executeScript",
                        system: {
                            events: subscribedEvents,
                            source: `if (!game.user.isGM) return;\nif (game.modules.get('${MODULE_ID}')?.api?.handleRegionEvent) {\n  game.modules.get('${MODULE_ID}').api.handleRegionEvent(event, '${cfg.originItem.uuid}');\n}`
                        }
                    });
                }

                if (terrainEffect === "difficult" || terrainEffect === "greater") {
                    const cost = terrainEffect === "greater" ? 3 : 2;
                    behaviors.push({
                        name: "AoE Difficult Terrain",
                        type: "modifyMovementCost",
                        system: { difficulties: { walk: cost, crawl: cost, climb: cost, swim: cost, fly: cost, burrow: cost } }
                    });
                }

                const regionData = {
                    name: `${cfg.itemName} (AoE Hazard)`,
                    color: game.user.color,
                    shapes: regionShapes,
                    elevation: { bottom: -1000, top: 1000 },
                    behaviors: behaviors,
                    flags: { 
                        [MODULE_ID]: { 
                            isAoERegion: true, 
                            originItemUuid: cfg.originItem.uuid, 
                            persistentRules: persistentRules,
                            saveDC: cfg.saveDC, 
                            duration: cfg.hazardDuration || null,
                            spawnRound: game.combat?.round,
                            spawnTurn: game.combat?.turn,
                            templateData: { x: doc.x, y: doc.y, distance: doc.distance, t: doc.t }
                        } 
                    }
                };

                if (game.user.isGM) {
                    const newRegions = await canvas.scene.createEmbeddedDocuments("Region", [regionData]);
                    await doc.delete(); 
                    doc = newRegions[0]; 
                    await new Promise(resolve => setTimeout(resolve, 200)); 
                    
                    await createVisualGhost(canvas.scene, doc, game.user.color);
                } else {
                    window.aoeEasyResolveRoute("createRegion", {
                        sceneId: canvas.scene.id,
                        templateId: doc.id,
                        regionData: regionData,
                        userColor: game.user.color
                    });
                }
            }
        } else if (doc && doc.documentName === "Region" && needsRegion) {
            if (game.user.isGM) {
                await doc.update({
                    [`flags.${MODULE_ID}.isAoERegion`]: true,
                    [`flags.${MODULE_ID}.originItemUuid`]: cfg.originItem.uuid,
                    [`flags.${MODULE_ID}.persistentRules`]: persistentRules,
                    [`flags.${MODULE_ID}.saveDC`]: cfg.saveDC,
                    [`flags.${MODULE_ID}.duration`]: cfg.hazardDuration || null,
                    [`flags.${MODULE_ID}.spawnRound`]: doc.getFlag(MODULE_ID, "spawnRound") ?? game.combat?.round,
                    [`flags.${MODULE_ID}.spawnTurn`]: doc.getFlag(MODULE_ID, "spawnTurn") ?? game.combat?.turn
                });

                const hasBehavior = doc.behaviors?.some(b => b.name === `AoE Easy Resolve Controller`);
                if (!hasBehavior && subscribedEvents.length > 0) {
                    await doc.createEmbeddedDocuments("RegionBehavior", [{
                        name: `AoE Easy Resolve Controller`,
                        type: `executeScript`,
                        system: {
                            events: subscribedEvents,
                            source: `console.log('AoE Easy Resolve | Region Behavior Script Firing!', event);\nif (game.modules.get('${MODULE_ID}')?.api?.handleRegionEvent) {\n  game.modules.get('${MODULE_ID}').api.handleRegionEvent(event, '${cfg.originItem.uuid}');\n}`
                        }
                    }]);
                }
                
                const hasTerrainBehavior = doc.behaviors?.some(b => b.name === `AoE Difficult Terrain`);
                if (!hasTerrainBehavior && (terrainEffect === "difficult" || terrainEffect === "greater")) {
                    const cost = terrainEffect === "greater" ? 3 : 2;
                    await doc.createEmbeddedDocuments("RegionBehavior", [{
                        name: "AoE Difficult Terrain",
                        type: "modifyMovementCost",
                        system: { difficulties: { walk: cost, crawl: cost, climb: cost, swim: cost, fly: cost, burrow: cost } }
                    }]);
                }
                
                await createVisualGhost(canvas.scene, doc, game.user.color);
            } else {
                window.aoeEasyResolveRoute("updateRegion", {
                    sceneId: canvas.scene.id,
                    regionId: doc.id,
                    originItemUuid: cfg.originItem.uuid,
                    persistentRules: persistentRules,
                    saveDC: cfg.saveDC,
                    hazardDuration: cfg.hazardDuration || null,
                    userColor: game.user.color,
                    subscribedEvents: subscribedEvents
                });
            }
        }

        let targetedTokens = [];

        if (doc && doc.documentName === "Region") {
            await new Promise(resolve => setTimeout(resolve, 250));
            const regionObj = doc.object || canvas.regions.get(doc.id);
            
            targetedTokens = canvas.tokens.placeables.filter(t => {
                if (regionObj && typeof regionObj.testPoint === "function") {
                    return regionObj.testPoint(t.center, t.document.elevation);
                }
                return false;
            });
        } else if (doc && doc.documentName === "MeasuredTemplate") {
            await new Promise(resolve => setTimeout(resolve, 250));
            
            targetedTokens = canvas.tokens.placeables.filter(t => {
                const templateObj = doc.object || canvas.templates.get(doc.id);
                if (templateObj && templateObj.shape) {
                    return templateObj.shape.contains(t.center.x - doc.x, t.center.y - doc.y);
                }
                return false;
            });
        } else if (cfg.preselectedTargets) {
            targetedTokens = cfg.preselectedTargets;
        }

        targetedTokens = targetedTokens.map(t => t.document ? t.document : t).filter(Boolean);

        const shouldLinger = persistentRules.length > 0 || terrainEffect === "difficult" || terrainEffect === "greater" || hasDuration;
        if (targetedTokens.length === 0) { 
            ui.notifications.info("AoE Easy Resolve | No targets initially caught or selected."); 
            if (!shouldLinger && doc) {
                setTimeout(async () => { try { await doc.delete(); } catch(e) {} }, 100);
            }
            return; 
        }

        if (doc) {
            createVisualBurst(doc, game.user.color);
        } else if (cfg.preselectedTargets) {
            cfg.preselectedTargets.forEach(t => {
                createVisualBurst({ x: t.center?.x || t.x, y: t.center?.y || t.y, object: t }, game.user.color);
            });
        }

        let tauntNoticeHtml = "";
        const casterActor = cfg.originItem?.actor;
        if (casterActor) {
            const tauntEffect = casterActor.items.find(i => i.getFlag('world', 'guardianTaunter'));
            if (tauntEffect) {
                const guardianId = tauntEffect.getFlag('world', 'guardianTaunter');
                let targetedAllies = false;
                let targetedGuardian = false;

                targetedTokens.forEach(t => {
                    if (t.actor?.id === guardianId) targetedGuardian = true;
                    else if (t.actor?.alliance === 'party') targetedAllies = true;
                });

                if (targetedAllies && !targetedGuardian) {
                    if (cfg.saveDC) {
                        cfg.saveDC -= 1;
                        tauntNoticeHtml = `<div style="color: #d92c2c; background: rgba(217, 44, 44, 0.1); border: 1px solid #d92c2c; padding: 4px; text-align: center; font-weight: bold; margin-bottom: 6px;">Guardian Taunt Penalty:<br>DC Reduced by 1</div>`;
                    }

                    const alreadyOffGuard = casterActor.items.some(i => i.system?.slug === 'taunt-off-guard-penalty');
                    if (!alreadyOffGuard) {
                        const offGuardEffect = {
                            name: "Off-Guard (Taunt Penalty)",
                            type: "effect",
                            img: "systems/pf2e/icons/conditions/off-guard.webp",
                            system: {
                                slug: "taunt-off-guard-penalty",
                                duration: { value: 1, unit: "rounds", expiry: "turn-start" },
                                description: { value: "You ignored a Guardian's taunt. You are Off-Guard." },
                                rules: [
                                    { key: "FlatModifier", selector: "ac", value: -2, type: "circumstance" },
                                    { key: "RollOption", domain: "all", option: "off-guard" }
                                ]
                            }
                        };
                        casterActor.createEmbeddedDocuments("Item", [offGuardEffect]);
                        
                        ChatMessage.create({
                            speaker: ChatMessage.getSpeaker({ actor: casterActor }),
                            flavor: `<strong>Taunt Penalty Triggered!</strong>`,
                            content: `Because ${casterActor.name} caught an ally in their blast without including their taunter, their DC was reduced, and they are now <strong>Off-Guard</strong> until the start of their next turn.`
                        });
                    }
                }
            }
        }

        const itemTraits = cfg.originItem?.system?.traits?.value || [];
        const isVitality = itemTraits.includes("vitality") || itemTraits.includes("positive");
        const isVoid = itemTraits.includes("void") || itemTraits.includes("negative");
        const isHealingTrait = itemTraits.includes("healing");

        const enemyBaseEffect = cfg.originItem?.flags?.[MODULE_ID]?.enemyBaseEffect || "standard";
        const allyBaseEffect = cfg.originItem?.flags?.[MODULE_ID]?.allyBaseEffect || "standard";
        const casterAlliance = cfg.originItem?.actor?.alliance || "party";

        const targetsData = {};
        targetedTokens.forEach(t => {
            const negativeHealing = t.actor?.system?.attributes?.hp?.negativeHealing || false;
            let effectType = "standard";

            if (isHealingTrait) {
                if (isVitality) effectType = negativeHealing ? "damage" : "heal";
                else if (isVoid) effectType = negativeHealing ? "heal" : "damage";
                else effectType = negativeHealing ? "none" : "heal";
            } else {
                if (isVitality) effectType = negativeHealing ? "damage" : "none";
                else if (isVoid) effectType = negativeHealing ? "none" : "damage";
            }

            if (effectType === "standard" && cfg.hazardDamage && cfg.hazardDamage.includes("healing")) effectType = negativeHealing ? "none" : "heal";

            const targetAlliance = t.actor?.alliance;
            const isAlly = targetAlliance === casterAlliance;
            const forcedEffect = isAlly ? allyBaseEffect : enemyBaseEffect;
            
            if (forcedEffect === "heal") effectType = "heal";
            if (forcedEffect === "immune") effectType = "none";

            targetsData[t.id] = { 
                id: t.id, name: t.name, img: t.texture.src, hasRolled: false, rollTotal: null, 
                degreeOfSuccess: null, isHealing: effectType === "heal", isImmune: effectType === "none",
                hasApplied: false
            };
        });

        // --- INTERCEPTOR: PRE-RENDER ---
        let payload = {
            targets: targetsData,
            originItem: cfg.originItem,
            itemName: cfg.itemName,
            saveType: cfg.saveType,
            saveDC: cfg.saveDC,
            hazardDamage: cfg.hazardDamage,
            caster: cfg.originItem?.actor
        };
        
        payload = await game.modules.get(MODULE_ID).api.runInterceptors("preRenderCard", payload) || payload;

        const templatePath = `modules/${MODULE_ID}/templates/chat-card.hbs`;
        const formattedSaveType = payload.saveType.charAt(0).toUpperCase() + payload.saveType.slice(1);
        
        let htmlContent = await renderHBS(templatePath, { 
            targets: formatTargetsData(payload.targets), itemName: payload.itemName, saveType: formattedSaveType, saveDC: payload.saveDC,
            damageTotal: null, damageBreakdown: null, damageFormula: null, damageTooltip: null, isGM: game.user.isGM
        });

        if (tauntNoticeHtml) {
            htmlContent = tauntNoticeHtml + htmlContent;
        }

        await ChatMessage.create({
            speaker: ChatMessage.getSpeaker(), content: htmlContent,
            flags: { [MODULE_ID]: { templateId: doc ? doc.id : null, documentName: doc ? doc.documentName : "ManualTarget", itemUuid: cfg.originItem ? cfg.originItem.uuid : null, itemName: cfg.itemName, saveType: cfg.saveType, saveDC: cfg.saveDC, isBasicSave: cfg.isBasicSave, targets: targetsData, hazardDamage: cfg.hazardDamage || null, isReactive: false, originMessageId: cfg.originMessageId } }
        });

    } catch (err) {
        console.error("AoE Easy Resolve | CRITICAL ERROR in generateTemplateCard:", err);
    }
}

// --- TEMPLATE CONVERSION ENGINE TRIGGER ---
const executeShapeProcessing = async (doc) => {
    setTimeout(async () => {
        try {
            let cache = window.aoeEasyResolveCache;
            window.aoeEasyResolveCache = null; 

            if (!cache && doc.flags?.pf2e?.origin?.uuid) {
                const originItem = await fromUuid(doc.flags.pf2e.origin.uuid);
                if (originItem) {
                    const aoeFlags = originItem.flags?.[MODULE_ID] || {};
                    let finalDC = aoeFlags.useOverride 
                        ? getSystemSaveDC(originItem, aoeFlags.dcType, aoeFlags.saveDC) 
                        : (originItem.system?.defense?.save?.dc?.value || getSystemSaveDC(originItem, "spell"));
                    let finalType = aoeFlags.useOverride ? aoeFlags.saveType : (originItem.system?.defense?.save?.statistic || "reflex");
                    
                    cache = {
                        item: originItem,
                        name: originItem.name,
                        dc: finalDC,
                        type: finalType,
                        hazardDuration: aoeFlags.hazardDuration || null,
                        castLevel: doc.flags?.pf2e?.origin?.castLevel || originItem.system?.level?.value || 1
                    };
                }
            }

            if (!cache) return; 

            const originItem = cache.item;
            if (originItem) {
                if (originItem.getFlag(MODULE_ID, "ignoreAoE")) return;

                const aoeFlags = originItem.flags?.[MODULE_ID] || {};
                const hasNativeSave = !!(originItem.system?.defense?.save?.statistic);
                const hasNativeDamage = !!(originItem.system?.damage && Object.keys(originItem.system.damage).length > 0);
                
                const isConfigured = aoeFlags.useOverride || 
                                     aoeFlags.useCustomDamage || 
                                     aoeFlags.provideTemplate || 
                                     (aoeFlags.rules && Object.keys(aoeFlags.rules).length > 0) || 
                                     aoeFlags.enableMultiTarget ||
                                     aoeFlags.isAreaDamage ||
                                     hasNativeSave ||
                                     hasNativeDamage ||
                                     aoeFlags.hazardDuration || 
                                     aoeFlags.terrainEffect === "difficult" || 
                                     aoeFlags.terrainEffect === "greater";
                if (!isConfigured) {
                    console.log("AoE Easy Resolve | Spell is an unconfigured utility. Ignoring template.");
                    return;
                }
            }

            let saveType = cache.type || "reflex"; 
            let saveDC = cache.dc;
            let isBasicSave = true;

            if (originItem) {
                isBasicSave = originItem.system?.defense?.save?.basic ?? true;
                const aoeFlags = originItem.flags?.[MODULE_ID];
                if (aoeFlags && aoeFlags.useOverride) {
                    saveType = aoeFlags.saveType || saveType;
                    saveDC = aoeFlags.saveDC || saveDC;
                    if (aoeFlags.isBasicSave !== undefined) isBasicSave = aoeFlags.isBasicSave;
                }
            }

            await generateTemplateCard(doc, {
                itemName: cache.name, 
                saveType: saveType, 
                saveDC: saveDC, 
                isBasicSave: isBasicSave, 
                originItem: originItem, 
                hazardDamage: cache.hazardDamage || null,
                hazardDuration: cache.hazardDuration || null,
                originMessageId: cache.originMessageId,
                castLevel: cache.castLevel || 1
            });

            if (canvas.activeLayer.name !== "TokenLayer") canvas.tokens.activate();

        } catch (err) { 
            console.error(`${MODULE_ID} | Error generating chat card:`, err); 
        }
    }, 150);
};

Hooks.on("createRegion", (doc, options, userId) => {
    if (game.user.id !== userId) return;
    if (doc.getFlag(MODULE_ID, "isAoERegion")) return; 
    executeShapeProcessing(doc);
});

Hooks.on("createMeasuredTemplate", (doc, options, userId) => {
    if (game.user.id !== userId) return;
    executeShapeProcessing(doc);
});

Hooks.on("deleteRegion", async (doc, options, userId) => {
    if (game.user.id !== userId) return;
    
    const ghostIds = doc.getFlag(MODULE_ID, "ghostDrawingIds");
    if (ghostIds && ghostIds.length > 0) {
        try {
            await doc.parent.deleteEmbeddedDocuments("Drawing", ghostIds);
        } catch(e) { 
            console.error("AoE Easy Resolve | Failed to clean up ghost drawings.", e); 
        }
    }

    setTimeout(async () => {
        const allTokens = doc.parent.tokens.contents;
        for (let t of allTokens) {
            if (!t.actor) continue;
            
            const effectsToDelete = t.actor.items.filter(i => 
                (i.type === "effect" || i.type === "condition") && 
                i.getFlag(MODULE_ID, "originRegion") === doc.id
            ).map(i => i.id);

            if (effectsToDelete.length > 0) {
                try {
                    await t.actor.deleteEmbeddedDocuments("Item", effectsToDelete);
                    console.log(`AoE Easy Resolve | Region expired. Swept ${effectsToDelete.length} orphaned effects from ${t.name}.`);
                } catch(e) {}
            }
        }
    }, 100);
});

Hooks.on("createRegion", (region) => {
    if (!window.aoeEasyResolveSpawnImmunity) window.aoeEasyResolveSpawnImmunity = {};
    window.aoeEasyResolveSpawnImmunity[region.id] = Date.now();
});

// --- AUTO-JANITOR: COMBAT DURATION CLEANUP ---
Hooks.on("updateCombat", async (combat, changed, options, userId) => {
    if (!game.user.isGM) return;

    console.log(`AoE Easy Resolve | Janitor woke up for Combat Round ${combat.round}, Turn ${combat.turn}`);

    const aoeRegions = canvas.scene.regions.filter(r => r.getFlag(MODULE_ID, "isAoERegion") && r.getFlag(MODULE_ID, "duration"));
    if (aoeRegions.length > 0) console.log(`AoE Easy Resolve | Janitor found ${aoeRegions.length} timed Regions.`);

    for (let region of aoeRegions) {
        const duration = parseInt(region.getFlag(MODULE_ID, "duration"));
        if (isNaN(duration)) continue;

        let spawnRound = region.getFlag(MODULE_ID, "spawnRound");
        if (spawnRound === undefined) {
            console.log(`AoE Easy Resolve | Stamping Region "${region.name}" with Spawn Round ${combat.round}`);
            await region.setFlag(MODULE_ID, "spawnRound", combat.round);
            continue; 
        }

        console.log(`AoE Easy Resolve | Region "${region.name}" - Spawned: Round ${spawnRound}, Current: Round ${combat.round}, Limit: ${duration}`);
        
        if (combat.round - spawnRound >= duration) {
            console.log(`AoE Easy Resolve | Duration expired! Sweeping region "${region.name}" off the board.`);
            try {
                await region.delete();
            } catch(e) { console.error("AoE Easy Resolve | Failed to delete region", e); }
        }
    }

    const aoeTemplates = canvas.scene.templates.filter(t => t.getFlag(MODULE_ID, "hazardDuration"));
    for (let template of aoeTemplates) {
        const duration = parseInt(template.getFlag(MODULE_ID, "hazardDuration"));
        if (isNaN(duration)) continue;

        let spawnRound = template.getFlag(MODULE_ID, "spawnRound");
        if (spawnRound === undefined) {
            await template.setFlag(MODULE_ID, "spawnRound", combat.round);
            continue; 
        }
        
        if (combat.round - spawnRound >= duration) {
            console.log(`AoE Easy Resolve | Duration expired! Sweeping naked template ${template.id}`);
            try {
                await template.delete();
            } catch(e) { console.error("AoE Easy Resolve | Failed to delete template", e); }
        }
    }
});