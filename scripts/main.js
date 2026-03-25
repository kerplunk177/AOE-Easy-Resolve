console.log("AoE Easy Resolve | Script loaded successfully.");

const MODULE_ID = "aoe-easy-resolve";
window.aoeEasyResolveCache = null;
window.aoeEasyResolveQueue = Promise.resolve();

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

// --- CORE RULES ENGINE EXECUTOR ---
// --- CORE RULES ENGINE EXECUTOR ---
async function executeEffectRules(targetsArray, contextStr, outcomeStr, originItem, messageActor) {
  if (!originItem) return;
  const flags = originItem.flags?.[MODULE_ID] || {};
  const rules = Array.isArray(flags.rules) ? flags.rules : Object.values(flags.rules || {});
  if (rules.length === 0) return;

  for (let rule of rules) {
      if (rule.context !== contextStr) continue;
      if (rule.outcome !== outcomeStr) continue;
      
      // Filter targets by trait requirement (Now supports comma-separated lists)
      let validTargets = targetsArray;
      if (rule.trait && rule.trait.trim() !== "") {
          // Split the string by commas, trim whitespace, and drop any empty leftover strings
          const reqTraits = rule.trait.split(",").map(t => t.trim().toLowerCase()).filter(t => t !== "");
          
          validTargets = targetsArray.filter(t => {
              const actorTraits = t.actor?.system?.traits?.value || [];
              // Check if the actor possesses AT LEAST ONE of the requested traits
              return actorTraits.some(tr => reqTraits.includes(tr.toLowerCase()));
          });
      }

      if (validTargets.length === 0) continue; 

      // Apply Condition
      if (rule.conditionUuid) {
          try {
              const conditionItem = await fromUuid(rule.conditionUuid);
              if (conditionItem) {
                  for (let t of validTargets) {
                      if (t.actor) await t.actor.createEmbeddedDocuments("Item", [conditionItem.toObject()]);
                  }
                  ui.notifications.info(`AoE Easy Resolve | Applied ${conditionItem.name}.`);
              }
          } catch(e) { console.error("AoE Easy Resolve | Error applying condition", e); }
      }

      // Apply Bonus Damage
      if (rule.damageFormula) {
          try {
              const formula = rule.damageType ? `(${rule.damageFormula})[${rule.damageType}]` : rule.damageFormula;
              const pf2eDamageClass = CONFIG.Dice.rolls.find(r => r.name === "DamageRoll") || Roll;
              const dRoll = await new pf2eDamageClass(formula).evaluate({ async: true });

              if (game.dice3d) await game.dice3d.showForRoll(dRoll, game.user, true);

              const outcomeLabels = { criticalSuccess: "Critical", success: "Hit/Success", failure: "Miss/Failure", criticalFailure: "Critical Miss" };
              const traitNotice = rule.trait ? ` (vs ${rule.trait})` : "";
              
              await ChatMessage.create({
                  speaker: ChatMessage.getSpeaker({ actor: messageActor }),
                  flavor: `<strong>${outcomeLabels[outcomeStr]} Effect Damage!${traitNotice}</strong><br><span style="font-size: 0.9em; color: #555;">Triggered by: ${originItem.name}</span>`,
                  content: await dRoll.render(),
                  rolls: [dRoll]
              });
          } catch(e) { console.error("AoE Easy Resolve | Error rolling bonus damage", e); }
      }
  }
}

// --- INITIALIZATION ---
Hooks.once("init", async function () {
  console.log(`${MODULE_ID} | Initializing module`);
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

  // Process the Rules array for Handlebars
  const rawRules = Array.isArray(flags.rules) ? flags.rules : Object.values(flags.rules || {});
  const processedRules = rawRules.map((r, i) => ({
      index: i,
      isAttack: r.context === "attack" || !r.context,
      isSave: r.context === "save",
      isCS: r.outcome === "criticalSuccess",
      isS: r.outcome === "success",
      isF: r.outcome === "failure",
      isCF: r.outcome === "criticalFailure",
      trait: r.trait || "",
      conditionUuid: r.conditionUuid || "",
      damageFormula: r.damageFormula || "",
      damageTypeOptions: damageTypeOptions.map(dto => ({ ...dto, selected: r.damageType === dto.key ? "selected" : "" }))
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
    damageTypeOptions: damageTypeOptions,
    multipliers: flags.multipliers || { criticalSuccess: "0", success: "0.5", failure: "1", criticalFailure: "2" },
    processedRules: processedRules
  };

  // Turn the rendered string directly into a jQuery object
  const $configHtml = $(await renderTemplate(templatePath, renderData));

  let insertTarget = html.find(".tab[data-tab='details']");
  if (insertTarget.length === 0) insertTarget = html.find("form");
  insertTarget.append($configHtml);

  // Bind listeners strictly to our injected block
  $configHtml.find(".add-rule-btn").click(async (ev) => {
      ev.preventDefault();
      const currentRules = Array.isArray(flags.rules) ? [...flags.rules] : Object.values(flags.rules || {});
      currentRules.push({ context: "attack", outcome: "criticalSuccess", trait: "", conditionUuid: "", damageFormula: "", damageType: "" });
      
      // Use setFlag to safely manage the array state
      await app.item.setFlag(MODULE_ID, "rules", currentRules);
  });

  $configHtml.find(".delete-rule-btn").click(async (ev) => {
      ev.preventDefault();
      const index = $(ev.currentTarget).data("index");
      const currentRules = Array.isArray(flags.rules) ? [...flags.rules] : Object.values(flags.rules || {});
      currentRules.splice(index, 1);
      
      await app.item.setFlag(MODULE_ID, "rules", currentRules);
  });

  if (typeof app._restoreScrollPositions === "function") app._restoreScrollPositions(html);
});

// --- CHAT MESSAGE ROUTER ---
Hooks.on("createChatMessage", async (message, options, userId) => {
  const flags = message.flags[MODULE_ID];
  
  // 1. WHISPER ROUTER
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
              rollTooltip: data.rollTooltip, degreeOfSuccess: data.dos, unadjustedDegreeOfSuccess: data.unadjustedDos
            } 
          });
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
        
        const newHtmlContent = await renderTemplate(templatePath, { 
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

  // 2. ATTACK ROLL RESOLUTION
  if (message.isAuthor) {
    const context = message.flags?.pf2e?.context;
    if (context && context.type === "attack-roll") {
      const outcome = context.outcome; 
      if (!outcome) return;

      const item = message.item;
      if (!item) return;

      const targets = Array.from(game.user.targets);
      // Fire the Rules Engine!
      await executeEffectRules(targets, "attack", outcome, item, message.actor);
    }
  }
});

// --- CHAT CARD INTERACTIVITY ---
Hooks.on("renderChatMessage", (message, html, data) => {
  const item = message.item;
  const flags = item?.flags[MODULE_ID] || {};

  const isRollCard = message.isRoll || message.rolls?.length > 0 || message.flags.pf2e?.context?.type;
  
  // Custom Template Button logic
  if (item && flags.provideTemplate && !isRollCard) {
    if (html.find(".easy-resolve-custom-template-btn").length === 0) {
      const btnHtml = `<button type="button" class="easy-resolve-custom-template-btn" style="margin-top: 5px; border: 1px solid #7a7971; background: rgba(0, 0, 0, 0.1);"><i class="fas fa-ruler-combined"></i> Place Custom Template</button>`;
      html.find(".message-content").append(btnHtml);

      html.find(".easy-resolve-custom-template-btn").click(async (ev) => {
        ev.preventDefault();
        window.aoeEasyResolveCache = {
          item: item, name: item.name,
          dc: flags.useOverride ? flags.saveDC : (item.system?.defense?.save?.dc?.value || null),
          type: flags.useOverride ? flags.saveType : (item.system?.defense?.save?.statistic || "reflex")
        };

        const toolMap = { "cone": "cone", "circle": "circle", "ray": "ray", "rect": "rect" };
        const selectedTool = toolMap[flags.templateType || "cone"];
        const targetDistance = flags.templateDistance || 15;

        canvas.templates.activate();
        const measureControl = ui.controls.controls.find(c => c.name === "measure");
        if (measureControl) { measureControl.activeTool = selectedTool; ui.controls.render(); }
        ui.notifications.info(`AoE Easy Resolve | Draw your template! It will auto-size to ${targetDistance}ft.`);
      });
    }
  }

  // Native PF2e Template Listener
  const templateButtons = html.find('[data-pf2-action="createTemplate"], .inline-template, button[data-action="spellTemplate"], button[data-action="place-template"], button:contains("burst"), button:contains("cone"), button:contains("line"), button:contains("emanation")');
  templateButtons.click((ev) => {
    const aoeFlags = item?.flags[MODULE_ID] || {};
    let fallbackName = item?.name || "AoE Effects";
    if (!item && message.flavor) fallbackName = message.flavor.replace(/<[^>]*>?/gm, '').trim();

    let finalDC = aoeFlags.useOverride ? aoeFlags.saveDC : (item?.system?.defense?.save?.dc?.value || null);
    let finalType = aoeFlags.useOverride ? aoeFlags.saveType : (item?.system?.defense?.save?.statistic || null);

    if (!finalDC) {
      const dcMatch = html.text().match(/DC\s*(\d+)/i);
      if (dcMatch) finalDC = parseInt(dcMatch[1], 10);
    }
    if (!finalType) {
      const cardText = html.text().toLowerCase();
      if (cardText.includes("fortitude")) finalType = "fortitude";
      else if (cardText.includes("will")) finalType = "will";
      else finalType = "reflex"; 
    }

    window.aoeEasyResolveCache = { item: item, name: fallbackName, dc: finalDC, type: finalType };
  });

  const targetsFlag = message.getFlag(MODULE_ID, "targets");
  if (!targetsFlag) return; 

  const isGM = game.user.isGM;
  if (!isGM) {
    html.find(".apply-damage-btn").hide();
    html.find(".roll-all-npcs-btn").hide();
    if (!message.isAuthor) html.find(".roll-damage-btn").hide();
  }

  html.find(".roll-save-btn").each((index, element) => {
    const btn = $(element);
    const tokenId = element.dataset.tokenId;
    const token = canvas.tokens?.get(tokenId);
    if (!isGM) {
      if (!token || !token.actor?.isOwner) btn.replaceWith('<span style="color: #777; font-style: italic; padding: 4px;">Awaiting...</span>');
    }
  });

  html.find(".roll-damage-btn").click(async (event) => {
    event.preventDefault();
    const aoeData = message.flags[MODULE_ID];
    
    let originItem = null;
    if (aoeData.itemUuid) originItem = await fromUuid(aoeData.itemUuid);

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
      const rollResult = await originItem.rollDamage({ event: event });
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
      
      const newHtmlContent = await renderTemplate(templatePath, { 
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

  html.find(".roll-all-npcs-btn").click(async (event) => {
    event.preventDefault();
    const aoeData = message.flags[MODULE_ID];
    if (!aoeData || !aoeData.targets) return;

    const saveType = aoeData.saveType || "reflex";
    const saveDC = aoeData.saveDC;
    
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
      
      const rollResult = await token.actor.saves[saveType].roll(rollOptions);
      if (!rollResult) continue;
      if (game.dice3d) game.dice3d.showForRoll(rollResult, game.user, true);
      
      let d20 = 10;
      const d20Term = rollResult.terms?.find(t => t.faces === 20);
      if (d20Term) d20 = d20Term.results?.[0]?.result ?? d20Term.total ?? 10;
      else if (rollResult.dice?.[0]) d20 = rollResult.dice[0].results?.[0]?.result ?? rollResult.dice[0].total ?? 10;

      const modifier = rollResult.total - d20;
      const modSign = modifier >= 0 ? "+" : "-";
      const rollTooltip = `(${d20} ${modSign} ${Math.abs(modifier)})`;

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
        
        const newHtmlContent = await renderTemplate(templatePath, { 
          targets: formatTargetsData(freshAoeData.targets), itemName: freshAoeData.itemName,
          saveType: formattedSaveType, saveDC: saveDC, damageTotal: freshAoeData.damageTotal,
          damageBreakdown: freshAoeData.damageBreakdown, damageFormula: freshAoeData.damageFormula, isGM: game.user.isGM
        });
        await freshMessage.update({ content: newHtmlContent });
      }
  });

  html.find(".roll-save-btn").click(async (event) => {
    event.preventDefault();
    const tokenId = event.currentTarget.dataset.tokenId;
    const token = canvas.tokens.get(tokenId);
    if (!token || !token.actor) return;

    const aoeData = message.flags[MODULE_ID] || {};
    const saveType = aoeData.saveType || "reflex";
    const saveDC = aoeData.saveDC;

    const rollOptions = { event: event, createMessage: false };
    if (saveDC) rollOptions.dc = { value: saveDC };
    
    const rollResult = await token.actor.saves[saveType].roll(rollOptions);
    if (!rollResult) return;
  
    if (game.dice3d) await game.dice3d.showForRoll(rollResult, game.user, true);

    let d20 = 10;
    const d20Term = rollResult.terms?.find(t => t.faces === 20);
    if (d20Term) d20 = d20Term.results?.[0]?.result ?? d20Term.total ?? 10;
    else if (rollResult.dice?.[0]) d20 = rollResult.dice[0].results?.[0]?.result ?? rollResult.dice[0].total ?? 10;

    const modifier = rollResult.total - d20;
    const modSign = modifier >= 0 ? "+" : "-";
    const rollTooltip = `(${d20} ${modSign} ${Math.abs(modifier)})`;

    const rawDosValue = getUnadjustedDos(rollResult.total, saveDC, d20);
    const finalDosValue = rollResult.degreeOfSuccess ?? rollResult.options?.degreeOfSuccess;

    const dosMap = { 0: "criticalFailure", 1: "failure", 2: "success", 3: "criticalSuccess" };
    let dos = finalDosValue !== undefined ? dosMap[finalDosValue] : "success";
    let unadjustedDos = rawDosValue !== undefined ? dosMap[rawDosValue] : dos;
  
    if (game.user.isGM) {
      const updateKey = `flags.${MODULE_ID}.targets.${tokenId}`;
      await message.update({ 
        [updateKey]: { hasRolled: true, rollTotal: rollResult.total, rollFormula: rollResult.formula, rollTooltip: rollTooltip, degreeOfSuccess: dos, unadjustedDegreeOfSuccess: unadjustedDos } 
      });

      const freshMessage = game.messages.get(message.id);
      const freshAoeData = freshMessage.flags[MODULE_ID];
      const templatePath = `modules/${MODULE_ID}/templates/chat-card.hbs`;
      const formattedSaveType = saveType.charAt(0).toUpperCase() + saveType.slice(1);
      
      const newHtmlContent = await renderTemplate(templatePath, { 
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

  html.find(".apply-damage-btn").click(async (event) => {
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
    if (aoeData.itemUuid) { try { originItem = await fromUuid(aoeData.itemUuid); } catch(e) {} }

    const aoeFlags = originItem?.flags?.[MODULE_ID] || {};
    const itemMultipliers = aoeFlags.multipliers || {};
    let processedCount = 0;
    let needsDamageWarning = false;

    const itemHasDamage = (originItem?.system?.damage && Object.keys(originItem.system.damage).length > 0) || (aoeFlags.useCustomDamage && aoeFlags.customDamage) || aoeData.hazardDamage;
    if (itemHasDamage && !aoeData.damageTotal) needsDamageWarning = true;

    for (const [tokenId, targetData] of Object.entries(aoeData.targets)) {
      const token = canvas.tokens.get(tokenId);
      if (!token || !token.actor) continue;

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
      if (effectType === "none") { processedCount++; continue; }

      const isHealEffect = effectType === "heal";
      if (!targetData.hasRolled && !isHealEffect) continue;

      const dos = targetData.degreeOfSuccess || "failure"; 
      processedCount++; 

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
              speaker: ChatMessage.getSpeaker({ token: token.document }), flavor: `<strong>${originItem ? originItem.name : "Healing"}</strong>`,
              content: `<div class="dice-roll"><div class="dice-result"><div class="dice-total" style="color: #1e8b42; background: rgba(74, 222, 128, 0.1);">${actualHealed} Healing</div></div></div>`
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

      // Fire Save Rules for this specific target
      await executeEffectRules([token], "save", dos, originItem, message.actor);
    }

    if (processedCount > 0) {
      if (needsDamageWarning) ui.notifications.warn("AoE Easy Resolve | Processed saves, but you forgot to click 'Roll Damage' first!");
      else ui.notifications.info(`AoE Easy Resolve | Processed damage and effects for ${processedCount} targets.`);
    } else {
      ui.notifications.warn("AoE Easy Resolve | No targets have rolled saves yet.");
    }

    if (game.user.isGM && aoeData.templateId) {
      const templateExists = canvas.templates.get(aoeData.templateId);
      if (templateExists) {
        new Dialog({
          title: "Remove Template?", content: "<p>Do you want to remove the measured template from the canvas?</p>",
          buttons: {
            yes: {
              icon: '<i class="fas fa-trash"></i>', label: "Yes",
              callback: async () => { try { await canvas.scene.deleteEmbeddedDocuments("MeasuredTemplate", [aoeData.templateId]); ui.notifications.info("AoE Easy Resolve | Template removed."); } catch(e) {} }
            },
            no: { icon: '<i class="fas fa-times"></i>', label: "No" }
          }, default: "yes"
        }).render(true);
      }
    }
  });
});

// --- TEMPLATE GENERATION HELPERS ---
async function generateTemplateCard(templateObj, templateDoc, cfg) {
  const targetedTokens = canvas.tokens.placeables.filter(token => {
    const center = token.center;
    return templateObj.shape.contains(center.x - templateDoc.x, center.y - templateDoc.y);
  });

  if (targetedTokens.length === 0) { ui.notifications.info("AoE Easy Resolve | No tokens caught in the blast area."); return; }

  const itemTraits = cfg.originItem?.system?.traits?.value || [];
  const isVitality = itemTraits.includes("vitality") || itemTraits.includes("positive");
  const isVoid = itemTraits.includes("void") || itemTraits.includes("negative");
  const isHealingTrait = itemTraits.includes("healing");

  const targetsData = {};
  targetedTokens.forEach(t => {
    const negativeHealing = t.actor?.system?.attributes?.hp?.negativeHealing || false;
    let effectType = "standard";

    if (isVitality) effectType = negativeHealing ? "damage" : "heal";
    else if (isVoid) effectType = negativeHealing ? "heal" : "damage";
    else if (isHealingTrait) effectType = negativeHealing ? "none" : "heal";

    if (effectType === "standard" && cfg.hazardDamage && cfg.hazardDamage.includes("healing")) effectType = negativeHealing ? "none" : "heal";

    targetsData[t.id] = { 
      id: t.id, name: t.name, img: t.document.texture.src, hasRolled: false, rollTotal: null, 
      degreeOfSuccess: null, isHealing: effectType === "heal", isImmune: effectType === "none"
    };
  });

  const templatePath = `modules/${MODULE_ID}/templates/chat-card.hbs`;
  const formattedSaveType = cfg.saveType.charAt(0).toUpperCase() + cfg.saveType.slice(1);
  
  const htmlContent = await renderTemplate(templatePath, { 
    targets: formatTargetsData(targetsData), itemName: cfg.itemName, saveType: formattedSaveType, saveDC: cfg.saveDC,
    damageTotal: null, damageBreakdown: null, damageFormula: null, damageTooltip: null, isGM: game.user.isGM
  });

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker(), content: htmlContent,
    flags: { [MODULE_ID]: { templateId: templateDoc.id, itemUuid: cfg.originItem ? cfg.originItem.uuid : null, itemName: cfg.itemName, saveType: cfg.saveType, saveDC: cfg.saveDC, isBasicSave: cfg.isBasicSave, targets: targetsData, hazardDamage: cfg.hazardDamage || null } }
  });
}
  
// --- TEMPLATE DROPPED INTERCEPTOR ---
Hooks.on("createMeasuredTemplate", async (templateDoc, options, userId) => {
  if (game.user.id !== userId) return;

  setTimeout(async () => {
    try {
      const cache = window.aoeEasyResolveCache;
      window.aoeEasyResolveCache = null; 

      const templateObj = canvas.templates.get(templateDoc.id) || templateDoc.object;
      if (!templateObj || !templateObj.shape) return;

      if (!cache) {
        if (!game.user.isGM || !game.settings.get(MODULE_ID, "promptUntypedTemplates")) return;

        return new Dialog({
          title: "Manual AoE Hazard",
          content: `
            <p>Configure a custom save for this template, or close to ignore.</p>
            <div class="form-group"><label>Hazard Name</label><div class="form-fields"><input type="text" id="hazName" value="Environmental Hazard"></div></div>
            <div class="form-group"><label>Save Type</label><div class="form-fields"><select id="hazSave"><option value="reflex" selected>Reflex</option><option value="fortitude">Fortitude</option><option value="will">Will</option></select></div></div>
            <div class="form-group"><label>Save DC</label><div class="form-fields"><input type="number" id="hazDC" value="15"></div></div>
            <div class="form-group"><label>Damage Formula</label><div class="form-fields"><input type="text" id="hazDam" placeholder="e.g. 4d6[bludgeoning]"></div></div>
          `,
          buttons: {
            create: {
              icon: '<i class="fas fa-bolt"></i>', label: "Create Save Card",
              callback: async (html) => {
                await generateTemplateCard(templateObj, templateDoc, {
                  itemName: html.find("#hazName").val() || "Environmental Hazard", saveType: html.find("#hazSave").val(),
                  saveDC: parseInt(html.find("#hazDC").val(), 10) || null, isBasicSave: true, originItem: null, hazardDamage: html.find("#hazDam").val() || null
                });
              }
            }, cancel: { icon: '<i class="fas fa-times"></i>', label: "Ignore" }
          }, default: "create"
        }).render(true);
      }

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
        if (aoeFlags && aoeFlags.provideTemplate) {
          const targetDistance = aoeFlags.templateDistance || 15;
          await templateDoc.update({ distance: targetDistance });
        }
      }

      await generateTemplateCard(templateObj, templateDoc, {
        itemName: cache.name, saveType: saveType, saveDC: saveDC, isBasicSave: isBasicSave, originItem: originItem, hazardDamage: null
      });

      if (canvas.activeLayer.name !== "TokenLayer") canvas.tokens.activate();

    } catch (err) { console.error(`${MODULE_ID} | Error generating template chat card:`, err); }
  }, 150); 
});