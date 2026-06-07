console.log("AoE Easy Resolve | Script loaded successfully.");

const MODULE_ID = "aoe-easy-resolve";
window.aoeEasyResolveCache = null;
window.aoeEasyResolveQueue = Promise.resolve();
window.aoeEasyResolveDebounce = {};

// --- FOUNDRY V14 COMPATIBILITY WRAPPERS ---
const renderHBS = async (templatePath, data) => {
  if (foundry.applications?.handlebars?.renderTemplate) {
    return await foundry.applications.handlebars.renderTemplate(templatePath, data);
  }
  return await renderTemplate(templatePath, data);
};

// --- MODULE API EXPORTS ---
Hooks.once("setup", () => {
  const module = game.modules.get(MODULE_ID);
  
  module.api = {
    handleRegionEvent: async (regionEvent, originItemUuid) => {
      const token = regionEvent.data?.token || regionEvent.token;
      if (!token || !token.actor) return;

      const originItem = await fromUuid(originItemUuid);
      if (!originItem) return;

      const reverseEventMapping = {
        "tokenMoveIn": "tokenEnter",
        "tokenMoveOut": "tokenExit",
        "tokenMoveWithin": "tokenMove",
        "turnStart": "turnStart",
        "turnEnd": "turnEnd"
      };
      
      const moduleContext = reverseEventMapping[regionEvent.name] || regionEvent.name;
      const regionDoc = regionEvent.region || regionEvent.data?.region;

      const debounceKey = `${token.id}-${regionDoc?.id || 'unknown'}-${moduleContext}`;
      const now = Date.now();
      if (window.aoeEasyResolveDebounce[debounceKey] && now - window.aoeEasyResolveDebounce[debounceKey] < 2000) return;
      window.aoeEasyResolveDebounce[debounceKey] = now;

      console.log(`AoE Easy Resolve | API processing ${moduleContext} for ${token.name}`);
      
      await executeEffectRules([{ actor: token.actor, id: token.id, document: token }], moduleContext, "always", originItem, originItem.actor, regionDoc);
    }
  };
});

// --- COMBAT TRACKER: HAZARD DURATION CLEANUP ---
Hooks.on("updateCombat", async (combat, change, options, userId) => {
    if (!game.user.isGM) return;
    
    if (change.round !== undefined) {
        const scenes = Array.from(game.scenes);
        for (const scene of scenes) {
            const aoeRegions = Array.from(scene.regions || []).filter(r => r.getFlag(MODULE_ID, "isAoERegion") && r.getFlag(MODULE_ID, "duration"));
            
            for (const region of aoeRegions) {
                let currentDuration = region.getFlag(MODULE_ID, "duration");
                currentDuration -= 1;
                
                if (currentDuration <= 0) {
                    await region.delete();
                    ui.notifications.info(`AoE Easy Resolve | ${region.name} expired and dissipated.`);
                } else {
                    await region.setFlag(MODULE_ID, "duration", currentDuration);
                }
            }
        }
    }
});

// --- HELPER FUNCTIONS ---
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

// --- REACTIVE SAVE GENERATOR ---
async function generateReactiveSaveCard(tokenDoc, originItem, regionDoc) {
  const flags = originItem.flags?.[MODULE_ID] || {};
  const regionFlags = regionDoc?.flags?.[MODULE_ID] || {};
  
  const saveType = flags.useOverride ? flags.saveType : (originItem.system?.defense?.save?.statistic || "reflex");
  
  let saveDC = regionFlags.saveDC || null;
  if (!saveDC) saveDC = flags.useOverride ? flags.saveDC : (originItem.system?.defense?.save?.dc?.value || null);
  
  const isBasicSave = originItem.system?.defense?.save?.basic ?? true;

  const targetsData = {};
  targetsData[tokenDoc.id] = {
      id: tokenDoc.id, name: tokenDoc.name, img: tokenDoc.texture?.src || "",
      hasRolled: false, rollTotal: null, degreeOfSuccess: null,
      isHealing: false, isImmune: false, hasApplied: false
  };

  const templatePath = `modules/${MODULE_ID}/templates/chat-card.hbs`;
  const formattedSaveType = saveType.charAt(0).toUpperCase() + saveType.slice(1);
  const hazardName = originItem.name + " (Reaction)";

  const htmlContent = await renderHBS(templatePath, {
      targets: formatTargetsData(targetsData), itemName: hazardName,
      saveType: formattedSaveType, saveDC: saveDC,
      damageTotal: null, damageBreakdown: null, damageFormula: null, damageTooltip: null, isGM: game.user.isGM
  });

  await ChatMessage.create({
      speaker: ChatMessage.getSpeaker(), content: htmlContent,
      flags: {
        [MODULE_ID]: {
          itemUuid: originItem.uuid, itemName: hazardName,
          saveType: saveType, saveDC: saveDC, isBasicSave: isBasicSave,
          targets: targetsData, hazardDamage: null,
          isReactive: true, castLevel: originItem?.system?.level?.value || 1
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
    if (rule.context !== contextStr) continue;
      if (rule.outcome !== "always" && rule.outcome !== outcomeStr) continue;
      
      let validTargets = targetsArray;

      // Filter by Rule-Level Alliance
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

    // Filter by Trait Requirement (using the already-filtered validTargets)
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
              const conditionItem = await fromUuid(cleanUuid);
              if (conditionItem) {
                  const itemData = conditionItem.toObject();
                  for (let t of validTargets) {
                      if (t.actor) await t.actor.createEmbeddedDocuments("Item", [itemData]);
                  }
                  ui.notifications.info(`AoE Easy Resolve | Applied ${conditionItem.name}.`);
              } else {
                  console.warn(`AoE Easy Resolve | Could not locate UUID: ${cleanUuid}`);
              }
          } catch(e) { console.error("AoE Easy Resolve | Error applying condition", e); }
      }

      if (rule.damageFormula) {
          try {
              const formula = rule.damageType ? `(${rule.damageFormula})[${rule.damageType}]` : rule.damageFormula;
              const pf2eDamageClass = CONFIG.Dice.rolls.find(r => r.name === "DamageRoll") || Roll;
              const dRoll = await new pf2eDamageClass(formula).evaluate({ async: true });

              if (game.dice3d) await game.dice3d.showForRoll(dRoll, game.user, true);

              const outcomeLabels = { criticalSuccess: "Critical", success: "Hit/Success", failure: "Miss/Failure", criticalFailure: "Critical Miss", always: "Persistent" };
              const traitNotice = rule.trait ? ` (vs ${rule.trait})` : "";
              
              const speakerActor = messageActor || game.user.character;
              const speakerParams = speakerActor ? { actor: speakerActor } : {};
              
              await ChatMessage.create({
                  speaker: ChatMessage.getSpeaker(speakerParams),
                  flavor: `<strong>${outcomeLabels[outcomeStr] || "Effect"} Damage!${traitNotice}</strong><br><span style="font-size: 0.9em; color: #555;">Triggered by: ${originItem.name}</span>`,
                  content: await dRoll.render(),
                  rolls: [dRoll]
              });
          } catch(e) { console.error("AoE Easy Resolve | Error rolling bonus damage", e); }
      }
  }
}

// --- INITIALIZATION ---
// --- INITIALIZATION & CSS INJECTION ---
Hooks.once("init", async function () {
  console.log(`${MODULE_ID} | Initializing module`);

  // Inject Dynamic State-Aware CSS Animations
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

  if (foundry.data?.regionBehaviors?.RegionBehaviorType) {
      class AoEControllerBehavior extends foundry.data.regionBehaviors.RegionBehaviorType {
          static defineSchema() { return {}; }
          async _handleRegionEvent(event) {
              if (!game.user.isGM) return; 
              const uuid = this.parent.region.getFlag(MODULE_ID, "originItemUuid");
              if (uuid) {
                  game.modules.get(MODULE_ID).api.handleRegionEvent(event, uuid);
              }
          }
      }
      CONFIG.RegionBehavior.dataModels[`${MODULE_ID}.controller`] = AoEControllerBehavior;
      CONFIG.RegionBehavior.typeIcons[`${MODULE_ID}.controller`] = "fas fa-burst";
  }

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

// --- ITEM SHEET INJECTION ---
Hooks.on("renderItemSheet", async (app, html, data) => {
  if (!["spell", "feat", "action", "consumable", "weapon", "equipment", "melee"].includes(app.item.type)) return;

  const templatePath = `modules/${MODULE_ID}/templates/item-config.hbs`;
  const flags = app.item.flags[MODULE_ID] || {};

  const pf2eDamageTypes = CONFIG.PF2E?.damageTypes || {};
  const damageTypeOptions = Object.entries(pf2eDamageTypes).map(([key, name]) => {
    return { key: key, label: game.i18n.localize(name), selected: flags.customDamageType === key ? "selected" : "" };
  });
  damageTypeOptions.sort((a, b) => a.label.localeCompare(b.label));
  damageTypeOptions.unshift({ key: "", label: "None / Untyped", selected: !flags.customDamageType ? "selected" : "" });

  const rawRules = Array.isArray(flags.rules) ? flags.rules : Object.values(flags.rules || {});
  const processedRules = rawRules.map((r, i) => ({
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
    isAllianceAlly: r.alliance === "ally"
}));

const renderData = {
  ignoreAoE: flags.ignoreAoE || false,
  useOverride: flags.useOverride || false,
  provideTemplate: flags.provideTemplate || false,
  isCone: flags.templateType === "cone" || !flags.templateType,
  isCircle: flags.templateType === "circle",
  isRay: flags.templateType === "ray",
  isRect: flags.templateType === "rect",
  templateDistance: flags.templateDistance || 15,
  isFort: flags.saveType === "fortitude",
  isReflex: flags.saveType === "reflex" || !flags.saveType,
  isWill: flags.saveType === "will",
  saveDC: flags.saveDC || "",
  useCustomDamage: flags.useCustomDamage || false,
  customDamage: flags.customDamage || "",
  hazardDuration: flags.hazardDuration || "",
  tacticalDrawing: flags.tacticalDrawing || false,
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

const $html = html instanceof jQuery ? html : $(html);
const $configHtml = $(await renderHBS(templatePath, renderData));

let insertTarget = $html.find(".tab[data-tab='details']");
if (insertTarget.length === 0) insertTarget = $html.find("form");
insertTarget.append($configHtml);

$configHtml.find(".add-rule-btn").off("click").on("click", async (ev) => {
    ev.preventDefault();
    const currentRules = Array.isArray(flags.rules) ? [...flags.rules] : Object.values(flags.rules || {});
    currentRules.push({ context: "attack", outcome: "criticalSuccess", promptSave: false, trait: "", conditionUuid: "", damageFormula: "", damageType: "", alliance: "all" });
    await app.item.setFlag(MODULE_ID, "rules", currentRules);
});

$configHtml.find(".delete-rule-btn").off("click").on("click", async (ev) => {
    ev.preventDefault();
    const index = $(ev.currentTarget).data("index");
    const currentRules = Array.isArray(flags.rules) ? [...flags.rules] : Object.values(flags.rules || {});
    currentRules.splice(index, 1);
    await app.item.setFlag(MODULE_ID, "rules", currentRules);
});

if (typeof app._restoreScrollPositions === "function") app._restoreScrollPositions(html);
});
// --- CHAT MESSAGE ROUTER & AUTO-APPLY ---
Hooks.on("createChatMessage", async (message, options, userId) => {
  const flags = message.flags[MODULE_ID];
  
  if (flags && flags.isSocketPayload) {
    if (!game.user.isGM) return;
    const firstActiveGM = game.users.find(u => u.isGM && u.active);
    if (!firstActiveGM || game.user.id !== firstActiveGM.id) return;

    const data = flags.payload;
    window.aoeEasyResolveQueue = window.aoeEasyResolveQueue.then(async () => {
      try {
        await message.delete();
        const targetMessage = game.messages.get(data.messageId);
        if (!targetMessage) return;

        if (data.action === "updateSaveRoll") {
          const updateKey = `flags.${MODULE_ID}.targets.${data.tokenId}`;
          await targetMessage.update({ 
            [updateKey]: {
              hasRolled: true, rollTotal: data.rollTotal, rollFormula: data.rollFormula,
              rollTooltip: data.rollTooltip, degreeOfSuccess: data.dos, unadjustedDegreeOfSuccess: data.unadjustedDos,
              hasUsedHeroPoint: data.hasUsedHeroPoint || false,
              hasCover: data.hasCover || false
            } 
          });

          const aoeData = targetMessage.flags[MODULE_ID];
          const originItem = await fromUuid(aoeData.itemUuid);
          const itemHasDamage = aoeData.hazardDamage || (originItem?.system?.damage && Object.keys(originItem.system.damage).length > 0);
          
          if (!itemHasDamage) {
             const token = canvas.tokens.get(data.tokenId);
             const saveContext = aoeData.isReactive ? "reactiveSave" : "save"; // PHASE ROUTER
             if (token && token.actor) {
                 await executeEffectRules([{ actor: token.actor, id: token.id, document: token.document }], saveContext, data.dos, originItem, targetMessage.actor, null);
                 await targetMessage.update({ [`flags.${MODULE_ID}.targets.${data.tokenId}.hasApplied`]: true });
             }
          }

        } else if (data.action === "updateDamageRoll") {
          await targetMessage.update({
            [`flags.${MODULE_ID}.damageJSON`]: data.damageJSON, [`flags.${MODULE_ID}.damageTotal`]: data.damageTotal,
            [`flags.${MODULE_ID}.damageBreakdown`]: data.damageBreakdown, [`flags.${MODULE_ID}.damageFormula`]: data.damageFormula,
            [`flags.${MODULE_ID}.damageTooltip`]: data.damageTooltip
          });
        }

        const freshMessage = game.messages.get(data.messageId);
        const freshAoeData = freshMessage.flags[MODULE_ID];
        const templatePath = `modules/${MODULE_ID}/templates/chat-card.hbs`;
        const formattedSaveType = freshAoeData.saveType.charAt(0).toUpperCase() + freshAoeData.saveType.slice(1);
        
        const newHtmlContent = await renderHBS(templatePath, { 
          targets: formatTargetsData(freshAoeData.targets), itemName: freshAoeData.itemName,
          saveType: formattedSaveType, saveDC: freshAoeData.saveDC, damageTotal: freshAoeData.damageTotal,
          damageBreakdown: freshAoeData.damageBreakdown, damageFormula: freshAoeData.damageFormula,
          damageTooltip: freshAoeData.damageTooltip, isGM: game.user.isGM
        });
        await freshMessage.update({ content: newHtmlContent });
      } catch (error) { console.error(`${MODULE_ID} | WHISPER ROUTER CRASHED:`, error); }
    }).catch(err => { console.error(`${MODULE_ID} | Queue encountered an error:`, err); });
    return;
  }

  if (message.isAuthor) {
    const context = message.flags?.pf2e?.context;
    if (context && context.type === "attack-roll") {
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

  if (item && !isRollCard) {
    if ($html.find(".er-template-toolbar").length === 0) {
      
      let buttonsHtml = `<div class="er-template-toolbar" style="display: flex; flex-wrap: wrap; gap: 4px; margin-top: 5px;">`;
      
      if (flags.provideTemplate) {
          buttonsHtml += `
            <button type="button" class="er-draw-shape-btn" data-shape="burst" style="flex: 1; border: 1px solid #7a7971; background: rgba(0,0,0,0.1);"><i class="fas fa-circle"></i> Burst</button>
            <button type="button" class="er-draw-shape-btn" data-shape="cone" style="flex: 1; border: 1px solid #7a7971; background: rgba(0,0,0,0.1);"><i class="fas fa-play"></i> Cone</button>
            <button type="button" class="er-draw-shape-btn" data-shape="line" style="flex: 1; border: 1px solid #7a7971; background: rgba(0,0,0,0.1);"><i class="fas fa-ruler-horizontal"></i> Line</button>
          `;
      }
      if (isTactical) {
          buttonsHtml += `
            <button type="button" class="er-draw-rect-btn" title="Contiguous Squares" style="flex: 1; border: 1px solid #7a7971; background: rgba(0,0,0,0.1);"><i class="fas fa-th-large"></i> Rect</button>
            <button type="button" class="er-draw-poly-btn" title="Freehand Shape" style="flex: 1; border: 1px solid #7a7971; background: rgba(0,0,0,0.1);"><i class="fas fa-draw-polygon"></i> Free</button>
          `;
      }
      buttonsHtml += `</div>`;
      
      if (flags.provideTemplate || isTactical) {
          $html.find(".message-content").append(buttonsHtml);
      }

      const prepCache = () => {
        let finalDC = flags.useOverride ? flags.saveDC : (item.system?.defense?.save?.dc?.value || null);
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
          ui.controls.initialize({ control: "regions", tool: "polygon" });
          ui.notifications.info(`AoE Easy Resolve | Click points on the grid to draw a custom shape. Double-click or Right-click to close.`);
      });

      $html.find(".er-draw-rect-btn").off("click").on("click", async (ev) => {
          ev.preventDefault();
          prepCache();
          canvas.regions.activate();
          ui.controls.initialize({ control: "regions", tool: "rectangle" });
          ui.notifications.info(`AoE Easy Resolve | Click and drag on the grid to draw a rectangular hazard.`);
      });
    }
  }

  const templateButtons = $html.find('[data-pf2-action="createTemplate"], .inline-template, button[data-action="spellTemplate"], button[data-action="place-template"], button:contains("burst"), button:contains("cone"), button:contains("line"), button:contains("emanation")');
  templateButtons.on("click", (ev) => {
    const aoeFlags = item?.flags[MODULE_ID] || {};
    let fallbackName = item?.name || "AoE Effects";
    if (!item && message.flavor) fallbackName = message.flavor.replace(/<[^>]*>?/gm, '').trim();

    let finalDC = aoeFlags.useOverride ? aoeFlags.saveDC : (item?.system?.defense?.save?.dc?.value || null);
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

  // 1. STATE-AWARE PLAYER BEACONS (Roll Save)
  $html.find(".roll-save-btn").each((index, element) => {
    const btn = $(element);
    const tokenId = element.dataset.tokenId;
    const token = canvas.tokens?.get(tokenId);
    const targetData = aoeData.targets[tokenId];

    // If the token hasn't rolled yet, pulse bright blue to draw the player's eye
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

  // 2. STATE-AWARE GM BEACONS (Damage & Apply)
  if (isGM) {
      (async () => {
        // Async fetch to guarantee we know if the spell actually deals damage
        let originItem = item;
        if (!originItem && aoeData.itemUuid) {
            try { originItem = await fromUuid(aoeData.itemUuid); } catch (e) {}
        }
        
        const aoeFlags = originItem?.flags?.[MODULE_ID] || {};
        const itemHasDamage = aoeData.hazardDamage || 
                              (originItem?.system?.damage && Object.keys(originItem.system.damage).length > 0) || 
                              (aoeFlags.useCustomDamage && aoeFlags.customDamage);

        // Pulse the Damage button red if damage exists but hasn't been rolled yet
        if (itemHasDamage && (aoeData.damageTotal === undefined || aoeData.damageTotal === null)) {
            $html.find(".roll-damage-btn").addClass("er-pulse-gm");
        }

        // Check if there are valid targets awaiting final application
        let hasUnappliedTargets = false;
        for (const target of Object.values(aoeData.targets || {})) {
            if (!target.hasApplied && (target.hasRolled || target.isHealing)) {
                hasUnappliedTargets = true;
                break;
            }
        }

        // Pulse the Apply button green ONLY if damage is resolved (or not needed) AND targets are waiting
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
    const customDamageFormula = hazardDamage || aoeFlags.customDamage;
    const customDamageType = aoeFlags.customDamageType;

    let dRoll = null;
    let dmgMsg = null;

    if (useCustomDamage && customDamageFormula) {
      const pf2eDamageClass = CONFIG.Dice.rolls.find(r => r.name === "DamageRoll") || Roll;
      try {
        let safeFormula = customDamageFormula.replace(/\]\s*\+\s*/g, "], ");
        const fullFormula = customDamageType ? `(${safeFormula})[${customDamageType}]` : safeFormula;
        dRoll = new pf2eDamageClass(fullFormula);
        await dRoll.evaluate({ async: true });
      } catch (e) {
        ui.notifications.error(`AoE Easy Resolve | Invalid custom damage formula: ${customDamageFormula}`);
        return;
      }
    } else if (originItem?.system?.damage && Object.keys(originItem.system.damage).length > 0) {
      const rollOptions = { event: event };
      
      if (aoeData.castLevel) rollOptions.spellLevel = parseInt(aoeData.castLevel, 10);

      const rollResult = await originItem.rollDamage(rollOptions);
      if (!rollResult) return;
      if (rollResult.rolls?.length > 0) {
        dRoll = rollResult.rolls[0];
        dmgMsg = rollResult;
      } else if (Array.isArray(rollResult) && rollResult[0]?.rolls?.length > 0) {
        dRoll = rollResult[0].rolls[0];
        dmgMsg = rollResult[0];
      } else if (rollResult.total !== undefined) dRoll = rollResult;
    } else {
      ui.notifications.info("AoE Easy Resolve | This item has no damage configured.");
      return;
    }

    if (!dRoll) return;
    if (useCustomDamage && game.dice3d) await game.dice3d.showForRoll(dRoll, game.user, true);

    const damageJSON = JSON.stringify(dRoll.toJSON());
    const damageTotal = dRoll.total;
    const damageFormula = dRoll.formula;

    let diceStrings = [];
    if (dRoll.dice && dRoll.dice.length > 0) {
      dRoll.dice.forEach(d => diceStrings.push(`d${d.faces}: [${d.results.map(r => r.result).join(", ")}]`));
    }
    const damageTooltip = diceStrings.length > 0 ? diceStrings.join(" | ") : damageFormula;

    let breakdownArr = [];
    if (dRoll.instances) {
      dRoll.instances.forEach(i => {
        const type = i.type || "untyped";
        const cleanType = type.charAt(0).toUpperCase() + type.slice(1);
        breakdownArr.push(`${i.total} ${cleanType}`);
      });
    }
    const damageBreakdown = breakdownArr.length > 0 ? breakdownArr.join(", ") : damageTotal;

    if (dmgMsg && typeof dmgMsg.delete === "function") {
      try { if (game.user.isGM || dmgMsg.isAuthor) await dmgMsg.delete(); } catch(e) {}
    }

    if (game.user.isGM) {
      await message.update({
        [`flags.${MODULE_ID}.damageJSON`]: damageJSON, [`flags.${MODULE_ID}.damageTotal`]: damageTotal,
        [`flags.${MODULE_ID}.damageBreakdown`]: damageBreakdown, [`flags.${MODULE_ID}.damageFormula`]: damageFormula,
        [`flags.${MODULE_ID}.damageTooltip`]: damageTooltip
      });

      const freshMessage = game.messages.get(message.id);
      const freshAoeData = freshMessage.flags[MODULE_ID];
      const templatePath = `modules/${MODULE_ID}/templates/chat-card.hbs`;
      const formattedSaveType = freshAoeData.saveType.charAt(0).toUpperCase() + freshAoeData.saveType.slice(1);
      
      const newHtmlContent = await renderHBS(templatePath, { 
        targets: formatTargetsData(freshAoeData.targets), itemName: freshAoeData.itemName,
        saveType: formattedSaveType, saveDC: freshAoeData.saveDC, damageTotal: damageTotal,
        damageBreakdown: damageBreakdown, damageFormula: damageFormula, damageTooltip: damageTooltip, isGM: game.user.isGM
      });
      await freshMessage.update({ content: newHtmlContent });
    } else {
      await ChatMessage.create({
        whisper: ChatMessage.getWhisperRecipients("GM"), blind: true, content: "AoE Easy Resolve Data Payload",
        flags: {
          [MODULE_ID]: {
            isSocketPayload: true,
            payload: { action: "updateDamageRoll", messageId: message.id, damageJSON: damageJSON, damageTotal: damageTotal, damageBreakdown: damageBreakdown, damageFormula: damageFormula, damageTooltip: damageTooltip }
          }
        }
      });
    }
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
    
    if (npcsToRoll.length === 0) { ui.notifications.info("AoE Easy Resolve | No NPCs left to roll for."); return; }
    
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

      // PHASE ROUTER
      const saveContext = aoeData.isReactive ? "reactiveSave" : "save";
      if (!hasDamage) {
         await executeEffectRules([{ actor: token.actor, id: token.id, document: token.document }], saveContext, dos, originItem, message.actor, null);
         updateData[`flags.${MODULE_ID}.targets.${tokenId}.hasApplied`] = true;
      }
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
  
    if (game.user.isGM) {
      let updatePayload = { hasRolled: true, rollTotal: rollResult.total, rollFormula: rollResult.formula, rollTooltip: rollTooltip, degreeOfSuccess: dos, unadjustedDegreeOfSuccess: unadjustedDos, hasUsedHeroPoint: true, hasCover: false };
      
      // PHASE ROUTER
      const saveContext = aoeData.isReactive ? "reactiveSave" : "save";
      if (!hasDamage) {
         await executeEffectRules([{ actor: token.actor, id: token.id, document: token.document }], saveContext, dos, originItem, message.actor, null);
         updatePayload.hasApplied = true;
      }

      const updateKey = `flags.${MODULE_ID}.targets.${tokenId}`;
      await message.update({ [updateKey]: updatePayload });

      const freshMessage = game.messages.get(message.id);
      const freshAoeData = freshMessage.flags[MODULE_ID];
      const templatePath = `modules/${MODULE_ID}/templates/chat-card.hbs`;
      const formattedSaveType = saveType.charAt(0).toUpperCase() + saveType.slice(1);
      
      const newHtmlContent = await renderHBS(templatePath, { 
        targets: formatTargetsData(freshAoeData.targets), itemName: freshAoeData.itemName,
        saveType: formattedSaveType, saveDC: saveDC, damageTotal: freshAoeData.damageTotal,
        damageBreakdown: freshAoeData.damageBreakdown, damageFormula: freshAoeData.damageFormula, damageTooltip: freshAoeData.damageTooltip, isGM: game.user.isGM
      });
      await freshMessage.update({ content: newHtmlContent });
    } else {
      await ChatMessage.create({
        whisper: ChatMessage.getWhisperRecipients("GM"), blind: true, content: "AoE Easy Resolve Data Payload",
        flags: { [MODULE_ID]: { isSocketPayload: true, payload: { action: "updateSaveRoll", messageId: message.id, tokenId: tokenId, rollTotal: rollResult.total, rollFormula: rollResult.formula, rollTooltip: rollTooltip, dos: dos, unadjustedDos: unadjustedDos } } }
      });
    }
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
      let updatePayload = { hasRolled: true, rollTotal: rollResult.total, rollFormula: rollResult.formula, rollTooltip: rollTooltip, degreeOfSuccess: dos, unadjustedDegreeOfSuccess: unadjustedDos, hasUsedHeroPoint: true };
      
      // PHASE ROUTER
      const saveContext = aoeData.isReactive ? "reactiveSave" : "save";
      if (!hasDamage) {
         await executeEffectRules([{ actor: token.actor, id: token.id, document: token.document }], saveContext, dos, originItem, message.actor, null);
         updatePayload.hasApplied = true;
      }

      const updateKey = `flags.${MODULE_ID}.targets.${tokenId}`;
      await message.update({ [updateKey]: updatePayload });

      const freshMessage = game.messages.get(message.id);
      const freshAoeData = freshMessage.flags[MODULE_ID];
      const templatePath = `modules/${MODULE_ID}/templates/chat-card.hbs`;
      const formattedSaveType = saveType.charAt(0).toUpperCase() + saveType.slice(1);
      
      const newHtmlContent = await renderHBS(templatePath, { 
        targets: formatTargetsData(freshAoeData.targets), itemName: freshAoeData.itemName,
        saveType: formattedSaveType, saveDC: saveDC, damageTotal: freshAoeData.damageTotal,
        damageBreakdown: freshAoeData.damageBreakdown, damageFormula: freshAoeData.damageFormula, damageTooltip: freshAoeData.damageTooltip, isGM: game.user.isGM
      });
      await freshMessage.update({ content: newHtmlContent });
    } else {
      await ChatMessage.create({
        whisper: ChatMessage.getWhisperRecipients("GM"), blind: true, content: "AoE Easy Resolve Data Payload",
        flags: { [MODULE_ID]: { isSocketPayload: true, payload: { action: "updateSaveRoll", messageId: message.id, tokenId: tokenId, rollTotal: rollResult.total, rollFormula: rollResult.formula, rollTooltip: rollTooltip, dos: dos, unadjustedDos: unadjustedDos, hasUsedHeroPoint: true, hasCover: false } } }
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

// Permission Lock: Only GM or Token Owner
if (!game.user.isGM && (!token || !token.actor?.isOwner)) return;

const freshMessage = game.messages.get(message.id);
const aoeData = freshMessage.flags[MODULE_ID];
const targetData = aoeData.targets[tokenId];

if (!targetData || !targetData.hasRolled) return;

const isApplyingCover = !targetData.hasCover;
const modifier = isApplyingCover ? 2 : -2;
const newTotal = targetData.rollTotal + modifier;

// Extract original d20 from the tooltip to perfectly recalculate the Degree of Success
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
    damageBreakdown: updatedAoeData.damageBreakdown, damageFormula: updatedAoeData.damageFormula, damageTooltip: updatedAoeData.damageTooltip, isGM: game.user.isGM
  });
  await updatedMessage.update({ content: newHtmlContent });
} else {
  await ChatMessage.create({
    whisper: ChatMessage.getWhisperRecipients("GM"), blind: true, content: "AoE Easy Resolve Data Payload",
    flags: { [MODULE_ID]: { isSocketPayload: true, payload: { action: "updateSaveRoll", messageId: message.id, tokenId: tokenId, rollTotal: newTotal, rollFormula: targetData.rollFormula, rollTooltip: newTooltip, dos: newDos, unadjustedDos: newDos, hasUsedHeroPoint: targetData.hasUsedHeroPoint, hasCover: isApplyingCover } } }
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

    const updateKey = `flags.${MODULE_ID}.targets.${tokenId}.degreeOfSuccess`;
    await freshMessage.update({ [updateKey]: newDos });

    const updatedMessage = game.messages.get(message.id);
    const updatedAoeData = updatedMessage.flags[MODULE_ID];
    const templatePath = `modules/${MODULE_ID}/templates/chat-card.hbs`;
    const formattedSaveType = updatedAoeData.saveType.charAt(0).toUpperCase() + updatedAoeData.saveType.slice(1);
    
    const newHtmlContent = await renderHBS(templatePath, { 
      targets: formatTargetsData(updatedAoeData.targets), itemName: updatedAoeData.itemName,
      saveType: formattedSaveType, saveDC: updatedAoeData.saveDC, damageTotal: updatedAoeData.damageTotal,
      damageBreakdown: updatedAoeData.damageBreakdown, damageFormula: updatedAoeData.damageFormula, damageTooltip: updatedAoeData.damageTooltip, isGM: game.user.isGM
    });
    await updatedMessage.update({ content: newHtmlContent });
  });

  $html.find(".apply-damage-btn").off("click").on("click", async (event) => {
    event.preventDefault();
    const freshMessage = game.messages.get(message.id);
    const aoeData = freshMessage.flags[MODULE_ID];
    if (!aoeData || !aoeData.targets) return;

    const pf2eDamageClass = CONFIG.Dice.rolls.find(r => r.name === "DamageRoll") || Roll;
    let pf2eDamageRoll = null;
    if (aoeData.damageJSON) {
      try { pf2eDamageRoll = pf2eDamageClass.fromJSON(aoeData.damageJSON); } catch (e) { console.error("AoE Easy Resolve | Failed to parse DamageRoll JSON.", e); }
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
    let needsDamageWarning = false;

    const itemHasDamage = (originItem?.system?.damage && Object.keys(originItem.system.damage).length > 0) || (aoeFlags.useCustomDamage && aoeFlags.customDamage) || aoeData.hazardDamage;
    if (itemHasDamage && !aoeData.damageTotal) needsDamageWarning = true;

    let msgUpdates = {};

    for (const [tokenId, targetData] of Object.entries(aoeData.targets)) {
      const token = canvas.tokens.get(tokenId);
      if (!token || !token.actor) continue;
      if (targetData.hasApplied) continue; 

      const negativeHealing = token.actor.system.attributes.hp?.negativeHealing || false;
      const itemTraits = originItem?.system?.traits?.value || [];
      const isVitality = itemTraits.includes("vitality") || itemTraits.includes("positive");
      const isVoid = itemTraits.includes("void") || itemTraits.includes("negative");
      const isHealingTrait = itemTraits.includes("healing");

      let effectType = "standard";
      let overrideType = null;

      if (isVitality) { effectType = negativeHealing ? "damage" : "heal"; overrideType = "vitality"; } 
      else if (isVoid) { effectType = negativeHealing ? "heal" : "damage"; overrideType = "void"; } 
      else if (isHealingTrait) { effectType = negativeHealing ? "none" : "heal"; }
      if (effectType === "standard" && pf2eDamageRoll && pf2eDamageRoll.instances?.some(i => i.type === "healing")) effectType = negativeHealing ? "none" : "heal";

      // Enforce Split Matrix for final math
      const targetAlliance = token.actor?.alliance;
      const casterAlliance = originItem?.actor?.alliance || "party";
      const isAlly = targetAlliance === casterAlliance;
      const forcedEffect = isAlly ? aoeFlags.allyBaseEffect : aoeFlags.enemyBaseEffect;
      
      if (forcedEffect === "heal") effectType = "heal";
      if (forcedEffect === "immune") effectType = "none";

      if (effectType === "none") { processedCount++; msgUpdates[`flags.${MODULE_ID}.targets.${tokenId}.hasApplied`] = true; continue; }

      const isHealEffect = effectType === "heal";
      if (!targetData.hasRolled && !isHealEffect) continue;

      const dos = targetData.degreeOfSuccess || "failure"; 
      processedCount++; 
      msgUpdates[`flags.${MODULE_ID}.targets.${tokenId}.hasApplied`] = true;

      // --- INJECT: BROADCAST FINALIZED SAVE TO COMBAT FORENSICS ---
      if (targetData.hasRolled) {
          Hooks.callAll('holodeckAoeSave', {
              targetDoc: token.actor,
              targetName: token.name,
              outcome: dos
          });
      }
      // ------------------------------------------------------------

      if (aoeData.damageTotal) {
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

        if (multiplier > 0) {
          if (isHealEffect) {
            const healAmount = aoeData.damageTotal;
            const currentHP = token.actor.system.attributes.hp.value;
            const maxHP = token.actor.system.attributes.hp.max;
            const actualHealed = Math.min(maxHP - currentHP, healAmount);
            const newHP = currentHP + actualHealed;
            
            await token.actor.update({ "system.attributes.hp.value": newHP });

            if (canvas.ready && actualHealed > 0) {
              canvas.interface.createScrollingText(token.center, `+${actualHealed}`, { anchor: CONST.TEXT_ANCHOR_POINTS.TOP, fill: 0x4ade80, direction: CONST.TEXT_ANCHOR_POINTS.UP });
            }
            
            await ChatMessage.create({
              speaker: ChatMessage.getSpeaker({ actor: token.actor, token: token.document }),
              flavor: `<span class="pf2e-damage-taken"><strong>${originItem ? originItem.name : "Healing"}</strong> (Recovery)</span>`,
              content: `<div class="dice-roll"><div class="dice-result"><div class="dice-total" style="color: #1e8b42; background: rgba(74, 222, 128, 0.1);"><strong>${token.name}</strong> recovered ${actualHealed} HP</div></div></div>`,
              flags: {
                  pf2e: {
                      context: { type: "damage-taken" },
                      appliedDamage: { isHealing: true, uuid: token.actor.uuid, updates: [{ path: "system.attributes.hp.value", value: newHP }] }
                  }
              }
            });
          } else {
            let damageToApply = Math.floor(aoeData.damageTotal * multiplier);
            if (pf2eDamageRoll) {
              try {
                let formulaParts = [];
                if (pf2eDamageRoll.instances) {
                  for (const inst of pf2eDamageRoll.instances) {
                    const scaled = Math.floor(inst.total * multiplier);
                    const flavor = overrideType || inst.type || "untyped";
                    formulaParts.push(`${scaled}[${flavor}]`);
                  }
                }
                if (formulaParts.length > 0) {
                  const newRoll = new pf2eDamageClass(formulaParts.join(", "));
                  await newRoll.evaluate({ async: true });
                  damageToApply = newRoll;
                }
              } catch (e) { console.warn("AoE Easy Resolve | Failed to rebuild scaled DamageRoll.", e); }
            }

            try {
              if (token.actor.applyDamage) {
                await token.actor.applyDamage({ damage: damageToApply, token: token.document, item: originItem });
              } else { throw new Error("PF2e applyDamage API not found on actor."); }
            } catch (error) {
              console.warn(`AoE Easy Resolve | Native applyDamage failed for ${token.name}. Using raw HP manipulation.`, error);
              try {
                const finalAmount = typeof damageToApply === "number" ? damageToApply : damageToApply.total;
                const currentHP = token.actor.system.attributes.hp.value;
                await token.actor.update({ "system.attributes.hp.value": Math.max(0, currentHP - finalAmount) });
              } catch (fallbackError) { console.error(`AoE Easy Resolve | Raw HP fallback failed for ${token.name}`, fallbackError); }
            }
          }
        }
      }

      // PHASE ROUTER
      const saveContext = aoeData.isReactive ? "reactiveSave" : "save";
      await executeEffectRules([token], saveContext, dos, originItem, message.actor);
    }
    
    if (Object.keys(msgUpdates).length > 0) {
        await message.update(msgUpdates);
    }

    if (processedCount > 0) {
      if (needsDamageWarning) ui.notifications.warn("AoE Easy Resolve | Processed saves, but you forgot to click 'Roll Damage' first!");
      else ui.notifications.info(`AoE Easy Resolve | Processed damage and effects for ${processedCount} targets.`);
    } else {
      ui.notifications.warn("AoE Easy Resolve | All valid targets have already been processed.");
    }

    if (game.user.isGM && aoeData.templateId) {
      const regionDoc = canvas.scene.regions?.get(aoeData.templateId);

      if (regionDoc) {
        new Dialog({
          title: `Remove Region?`, content: `<p>Do you want to remove the effect region from the canvas?</p>`,
          buttons: {
            yes: {
              icon: '<i class="fas fa-trash"></i>', label: "Yes",
              callback: async () => { 
                try { 
                  await regionDoc.delete(); 
                  ui.notifications.info(`AoE Easy Resolve | Region removed.`); 
                } catch(e) { console.error(e); } 
              }
            },
            no: { icon: '<i class="fas fa-times"></i>', label: "No" }
          }, default: "yes"
        }).render(true);
      }
    }
  });
});

// --- VISUAL GHOST GENERATOR ---
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

  // Bulletproof Coordinate Fetcher
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

      // Master Container
      const container = new PIXI.Container();
      container.x = x;
      container.y = y;
      container.zIndex = 99999;
      
      if (canvas.interface) canvas.interface.addChild(container);
      else if (canvas.effects) canvas.effects.addChild(container);
      else canvas.stage.addChild(container);

      const particles = [];

      // Micro-factory for varied, lingering bubbles
      const createParticle = (isEdge) => {
          const p = new PIXI.Graphics();
          
          p.beginFill(numericColor, 0.6);
          p.lineStyle(1, numericColor, 1);
          
          // Extreme size variance: 20% chance for a massive bubble, 80% for smaller motes
          const isChonky = Math.random() > 0.8;
          const size = isChonky ? Math.random() * 8 + 6 : Math.random() * 3 + 2; 
          p.drawCircle(0, 0, size);
          p.endFill();
          
          let angle = Math.random() * Math.PI * 2;
          let speed, px, py, vx, vy;
          // Massive lifespan boost: 180 to 300 frames (roughly 3 to 5 seconds)
          let life = Math.random() * 120 + 180; 

          if (isEdge) {
              // Spawn on perimeter
              px = Math.cos(angle) * radiusPixels;
              py = Math.sin(angle) * radiusPixels;
              let tangent = angle + Math.PI / 2;
              speed = Math.random() * 1.5 + 0.5; // Slightly slower initial launch
              vx = Math.cos(tangent) * speed;
              vy = Math.sin(tangent) * speed;
          } else {
              // Spawn near center
              px = (Math.random() - 0.5) * (radiusPixels * 0.4);
              py = (Math.random() - 0.5) * (radiusPixels * 0.4);
              speed = Math.random() * (radiusPixels / 25) + 0.5; // Gentler radial pop
              vx = Math.cos(angle) * speed;
              vy = Math.sin(angle) * speed;
          }

          p.x = px;
          p.y = py;
          
          container.addChild(p);
          return { gfx: p, vx, vy, life, maxLife: life };
      };

      // 50 edge dancers, 50 interior bubbles
      for(let i=0; i<50; i++) particles.push(createParticle(true));
      for(let i=0; i<50; i++) particles.push(createParticle(false));

      // Keep the anchor ring, extended life to match
      const ring = new PIXI.Graphics();
      ring.lineStyle(4, numericColor, 0.8);
      ring.drawCircle(0, 0, radiusPixels);
      container.addChild(ring);
      let ringLife = 90; 

      // The Physics Loop
      const animateParticles = () => {
          let allDead = true;

          // Expand and fade the anchor ring
          if (ringLife > 0) {
              ringLife--;
              ring.alpha = ringLife / 90;
              ring.scale.set(0.95 + (1 - ringLife/90) * 0.05); 
              allDead = false;
          }

          // Drift and fade the bubbles
          for (let i = particles.length - 1; i >= 0; i--) {
              let p = particles[i];
              if (p.life > 0) {
                  p.life--;
                  
                  p.gfx.x += p.vx;
                  p.gfx.y += p.vy;
                  
                  // Lighter friction so they drift lazily for their entire lifespan
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
  await new Promise(resolve => setTimeout(resolve, 300));

  const rules = Array.isArray(cfg.originItem?.flags?.[MODULE_ID]?.rules) ? cfg.originItem.flags[MODULE_ID].rules : Object.values(cfg.originItem?.flags?.[MODULE_ID]?.rules || {});
  const persistentRules = rules.filter(r => ["tokenEnter", "tokenExit", "tokenMove", "turnStart", "turnEnd"].includes(r.context));

  const eventMapping = { 
    "tokenEnter": ["tokenMoveIn"], 
    "tokenExit": ["tokenMoveOut"], 
    "tokenMove": ["tokenMoveWithin"],
    "turnStart": ["turnStart", "tokenTurnStart"], 
    "turnEnd": ["turnEnd", "tokenTurnEnd"] 
  };
  const subscribedEvents = [...new Set(persistentRules.flatMap(r => eventMapping[r.context] || []))];

  // --- FORCED CONVERTER: Delete the template and replace it with a true V14 Region ---
  if (doc.documentName === "MeasuredTemplate" && persistentRules.length > 0) {
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
      const behaviorData = {
        name: `AoE Easy Resolve Controller`,
        type: `executeScript`,
        system: {
            events: subscribedEvents,
            source: `console.log('AoE Easy Resolve | Region Behavior Script Firing!', event);\nif (game.modules.get('${MODULE_ID}')?.api?.handleRegionEvent) {\n  game.modules.get('${MODULE_ID}').api.handleRegionEvent(event, '${cfg.originItem.uuid}');\n}`
        }
      };

      const regionData = {
        name: `${cfg.itemName} (AoE Hazard)`,
        color: game.user.color,
        shapes: regionShapes,
        elevation: { bottom: -1000, top: 1000 }, 
        behaviors: [behaviorData],
        flags: { 
            [MODULE_ID]: { 
                isAoERegion: true, 
                originItemUuid: cfg.originItem.uuid, 
                persistentRules: persistentRules,
                saveDC: cfg.saveDC, 
                duration: cfg.hazardDuration || null
            } 
        }
      };

      const newRegions = await canvas.scene.createEmbeddedDocuments("Region", [regionData]);
      await doc.delete(); 
      doc = newRegions[0]; 
      await new Promise(resolve => setTimeout(resolve, 200)); 
      
      await createVisualGhost(canvas.scene, doc, game.user.color);
    }
  } else if (doc.documentName === "Region" && persistentRules.length > 0) {
    await doc.update({
        [`flags.${MODULE_ID}.isAoERegion`]: true,
        [`flags.${MODULE_ID}.originItemUuid`]: cfg.originItem.uuid,
        [`flags.${MODULE_ID}.persistentRules`]: persistentRules,
        [`flags.${MODULE_ID}.saveDC`]: cfg.saveDC,
        [`flags.${MODULE_ID}.duration`]: cfg.hazardDuration || null
    });

    const hasBehavior = doc.behaviors?.some(b => b.name === `AoE Easy Resolve Controller`);
    if (!hasBehavior) {
      await doc.createEmbeddedDocuments("RegionBehavior", [{
          name: `AoE Easy Resolve Controller`,
          type: `executeScript`,
          system: {
              events: subscribedEvents,
              source: `console.log('AoE Easy Resolve | Region Behavior Script Firing!', event);\nif (game.modules.get('${MODULE_ID}')?.api?.handleRegionEvent) {\n  game.modules.get('${MODULE_ID}').api.handleRegionEvent(event, '${cfg.originItem.uuid}');\n}`
          }
      }]);
    }
    
    await createVisualGhost(canvas.scene, doc, game.user.color);
  }

  let targetedTokens = [];
  if (doc.documentName === "Region") {
    if (doc.tokens && doc.tokens.size > 0) {
        targetedTokens = Array.from(doc.tokens);
    } else {
        targetedTokens = canvas.tokens.placeables.filter(token => {
            if (typeof doc.testPoint === "function") {
                return doc.testPoint({ x: token.center.x, y: token.center.y, elevation: token.document.elevation });
            } else if (doc.object && doc.object.shape) {
                return doc.object.shape.contains(token.center.x - doc.x, token.center.y - doc.y);
            }
            return false;
        });
    }
  } else if (doc.documentName === "MeasuredTemplate") {
    const templateObj = doc.object;
    if (templateObj && templateObj.shape) {
      targetedTokens = canvas.tokens.placeables.filter(token => templateObj.shape.contains(token.center.x - doc.x, token.center.y - doc.y));
    }
  }

  targetedTokens = targetedTokens.map(t => t.document ? t.document : t).filter(Boolean);
 // Visual Confirmation that automation succeeded (Moved above the empty-check)
 createVisualBurst(doc, game.user.color);

 const hasPersistent = persistentRules.length > 0;
 if (targetedTokens.length === 0) { 
   ui.notifications.info("AoE Easy Resolve | No targets initially caught in the blast area.");
    if (!hasPersistent) {
      setTimeout(async () => { try { await doc.delete(); } catch(e) {} }, 100);
      return; 
    }
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

    if (isVitality) effectType = negativeHealing ? "damage" : "heal";
    else if (isVoid) effectType = negativeHealing ? "heal" : "damage";
    else if (isHealingTrait) effectType = negativeHealing ? "none" : "heal";

    if (effectType === "standard" && cfg.hazardDamage && cfg.hazardDamage.includes("healing")) effectType = negativeHealing ? "none" : "heal";

    // Enforce Split Matrix
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

  const templatePath = `modules/${MODULE_ID}/templates/chat-card.hbs`;
  const formattedSaveType = cfg.saveType.charAt(0).toUpperCase() + cfg.saveType.slice(1);
  
  let htmlContent = await renderHBS(templatePath, { 
    targets: formatTargetsData(targetsData), itemName: cfg.itemName, saveType: formattedSaveType, saveDC: cfg.saveDC,
    damageTotal: null, damageBreakdown: null, damageFormula: null, damageTooltip: null, isGM: game.user.isGM
  });

  if (tauntNoticeHtml) {
      htmlContent = tauntNoticeHtml + htmlContent;
  }

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker(), content: htmlContent,
    flags: { [MODULE_ID]: { templateId: doc.id, documentName: doc.documentName, itemUuid: cfg.originItem ? cfg.originItem.uuid : null, itemName: cfg.itemName, saveType: cfg.saveType, saveDC: cfg.saveDC, isBasicSave: cfg.isBasicSave, targets: targetsData, hazardDamage: cfg.hazardDamage || null, isReactive: false, originMessageId: cfg.originMessageId } }
  });
}

const executeShapeProcessing = async (doc) => {
  setTimeout(async () => {
    try {
      const cache = window.aoeEasyResolveCache;
      window.aoeEasyResolveCache = null; 

      if (!cache) return; 

      const originItem = cache.item;
      if (originItem && originItem.getFlag && originItem.getFlag(MODULE_ID, "ignoreAoE")) return;

      let saveType = cache.type;
      let saveDC = cache.dc;
      let isBasicSave = true;

      if (originItem) {
        isBasicSave = originItem.system?.defense?.save?.basic ?? true;
        const aoeFlags = originItem.flags?.[MODULE_ID];
        if (aoeFlags && aoeFlags.useOverride) {
          saveType = aoeFlags.saveType || saveType;
          saveDC = aoeFlags.saveDC || saveDC;
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
        originMessageId: cache.originMessageId
      });

      if (canvas.activeLayer.name !== "TokenLayer") canvas.tokens.activate();

    } catch (err) { 
      console.error(`${MODULE_ID} | Error generating chat card:`, err); 
    }
  }, 150);
};

Hooks.on("createRegion", (doc, options, userId) => {
  if (game.user.id === userId) executeShapeProcessing(doc);
});

Hooks.on("createMeasuredTemplate", (doc, options, userId) => {
  if (game.user.id !== userId) return;
  if (doc.flags?.pf2e) return; 
  executeShapeProcessing(doc);
});

// --- GHOST CLEANUP ENGINE ---
Hooks.on("deleteRegion", async (doc, options, userId) => {
  if (game.user.id !== userId) return;
  const ghostIds = doc.getFlag(MODULE_ID, "ghostDrawingIds");
  if (ghostIds && ghostIds.length > 0) {
      try {
          await doc.parent.deleteEmbeddedDocuments("Drawing", ghostIds);
      } catch(e) { console.error("AoE Easy Resolve | Failed to clean up ghost drawings.", e); }
  }
});