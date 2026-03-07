console.log("AoE Easy Resolve | Script loaded successfully.");

const MODULE_ID = "aoe-easy-resolve";
window.aoeEasyResolveCache = null;
window.aoeEasyResolveQueue = Promise.resolve();


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

function formatTargetsData(targets) {
  const result = {};
  const getDosDetails = (dos) => {
    if (dos === "criticalSuccess") return { color: "rgb(0, 128, 0)", label: "Crit Success" };
    if (dos === "success") return { color: "rgb(0, 0, 255)", label: "Success" };
    if (dos === "failure") return { color: "rgb(255, 69, 0)", label: "Failure" };
    if (dos === "criticalFailure") return { color: "rgb(255, 0, 0)", label: "Crit Fail" };
    return { color: "inherit", label: "" };
  };

  for (const [id, t] of Object.entries(targets || {})) {
    const finalDos = getDosDetails(t.degreeOfSuccess);
    let unadjustedDosDetails = null;
    
    if (t.unadjustedDegreeOfSuccess !== undefined && t.unadjustedDegreeOfSuccess !== t.degreeOfSuccess) {
      unadjustedDosDetails = getDosDetails(t.unadjustedDegreeOfSuccess);
    }

    result[id] = { 
      ...t, 
      dosColor: finalDos.color, 
      dosLabel: finalDos.label,
      hasAdjustment: !!unadjustedDosDetails,
      unadjustedColor: unadjustedDosDetails?.color,
      unadjustedLabel: unadjustedDosDetails?.label
    };
  }
  return result;
}

Hooks.once("init", async function () {
    console.log(`${MODULE_ID} | Initializing module`);
  
    game.settings.register(MODULE_ID, "promptUntypedTemplates", {
      name: "Prompt Saves for Manual Templates",
      hint: "When the GM draws a measured template from the sidebar, prompt them to create a custom AoE save card (e.g., for falling rocks or environmental hazards).",
      scope: "world",
      config: true,
      type: Boolean,
      default: false
    });
  
    loadTemplates([
      `modules/${MODULE_ID}/templates/chat-card.hbs`,
      `modules/${MODULE_ID}/templates/item-config.hbs`
    ]);
  });

Hooks.on("createChatMessage", async (message, options, userId) => {
  const flags = message.flags[MODULE_ID];
  if (!flags || !flags.isSocketPayload) return;

  if (!game.user.isGM) return;
  const firstActiveGM = game.users.find(u => u.isGM && u.active);
  if (!firstActiveGM || game.user.id !== firstActiveGM.id) return;

  const data = flags.payload;
  console.log(`${MODULE_ID} | ⚡ WHISPER ROUTER RECEIVED PAYLOAD:`, data);

  window.aoeEasyResolveQueue = window.aoeEasyResolveQueue.then(async () => {
    try {
      await message.delete();

      const targetMessage = game.messages.get(data.messageId);
      if (!targetMessage) return;

      if (data.action === "updateSaveRoll") {
        const updateKey = `flags.${MODULE_ID}.targets.${data.tokenId}`;
        await targetMessage.update({ 
          [updateKey]: {
            hasRolled: true,
            rollTotal: data.rollTotal,
            rollFormula: data.rollFormula,
            rollTooltip: data.rollTooltip,
            degreeOfSuccess: data.dos,
            unadjustedDegreeOfSuccess: data.unadjustedDos
          } 
        });
      } else if (data.action === "updateDamageRoll") {
        await targetMessage.update({
          [`flags.${MODULE_ID}.damageJSON`]: data.damageJSON,
          [`flags.${MODULE_ID}.damageTotal`]: data.damageTotal,
          [`flags.${MODULE_ID}.damageBreakdown`]: data.damageBreakdown,
          [`flags.${MODULE_ID}.damageFormula`]: data.damageFormula,
          [`flags.${MODULE_ID}.damageTooltip`]: data.damageTooltip
        });
      }

      const freshMessage = game.messages.get(data.messageId);
      const freshAoeData = freshMessage.flags[MODULE_ID];
      const templatePath = `modules/${MODULE_ID}/templates/chat-card.hbs`;
      const formattedSaveType = freshAoeData.saveType.charAt(0).toUpperCase() + freshAoeData.saveType.slice(1);
      
      const newHtmlContent = await renderTemplate(templatePath, { 
        targets: formatTargetsData(freshAoeData.targets),
        itemName: freshAoeData.itemName,
        saveType: formattedSaveType,
        saveDC: freshAoeData.saveDC,
        damageTotal: freshAoeData.damageTotal,
        damageBreakdown: freshAoeData.damageBreakdown,
        damageFormula: freshAoeData.damageFormula,
        damageTooltip: freshAoeData.damageTooltip,
        isGM: game.user.isGM
      });
      
      await freshMessage.update({ content: newHtmlContent });
      
    } catch (error) {
      console.error(`${MODULE_ID} | WHISPER ROUTER CRASHED:`, error);
    }
  }).catch(err => {
    console.error(`${MODULE_ID} | Queue encountered an error:`, err);
  });
});


Hooks.on("renderItemSheet", async (app, html, data) => {
  if (!["spell", "feat", "action", "consumable", "weapon", "equipment"].includes(app.item.type)) return;

  const templatePath = `modules/${MODULE_ID}/templates/item-config.hbs`;
  const flags = app.item.flags[MODULE_ID] || {};

  const pf2eDamageTypes = CONFIG.PF2E?.damageTypes || {};
  const damageTypeOptions = Object.entries(pf2eDamageTypes).map(([key, name]) => {
    return {
      key: key,
      label: game.i18n.localize(name),
      selected: flags.customDamageType === key ? "selected" : ""
    };
  });
  damageTypeOptions.sort((a, b) => a.label.localeCompare(b.label));
  damageTypeOptions.unshift({ key: "", label: "None / Untyped", selected: !flags.customDamageType ? "selected" : "" });

  const renderData = {
    ignoreAoE: flags.ignoreAoE || false,
    useOverride: flags.useOverride || false,
    isFort: flags.saveType === "fortitude",
    isReflex: flags.saveType === "reflex" || !flags.saveType,
    isWill: flags.saveType === "will",
    saveDC: flags.saveDC || "",
    useCustomDamage: flags.useCustomDamage || false,
    customDamage: flags.customDamage || "",
    damageTypeOptions: damageTypeOptions,
    effects: flags.effects || {
      criticalSuccess: "",
      success: "",
      failure: "",
      criticalFailure: ""
    },
    multipliers: flags.multipliers || {
      criticalSuccess: "",
      success: "",
      failure: "",
      criticalFailure: ""
    }
  };

  const configHtml = await renderTemplate(templatePath, renderData);

  let insertTarget = html.find(".tab[data-tab='details']");
  if (insertTarget.length === 0) {
    insertTarget = html.find("form");
  }
  
  insertTarget.append(configHtml);

  if (typeof app._restoreScrollPositions === "function") {
    app._restoreScrollPositions(html);
  }
});


Hooks.on("renderChatMessage", (message, html, data) => {
  
  const templateButtons = html.find('button[data-action="spellTemplate"], button[data-action="place-template"], button:contains("burst"), button:contains("cone"), button:contains("line"), button:contains("emanation")');
  
  templateButtons.click((ev) => {
    const cardText = html.text();
    
    let scrapedDC = null;
    const dcMatch = cardText.match(/DC\s*(\d+)/i);
    if (dcMatch) scrapedDC = parseInt(dcMatch[1], 10);

    let scrapedType = "reflex";
    if (cardText.toLowerCase().includes("fortitude")) scrapedType = "fortitude";
    if (cardText.toLowerCase().includes("will")) scrapedType = "will";

    let fallbackName = "AoE Effects";
    if (message.item) fallbackName = message.item.name;
    else if (message.flavor) fallbackName = message.flavor.replace(/<[^>]*>?/gm, '').trim();

    window.aoeEasyResolveCache = {
      item: message.item,
      name: fallbackName,
      dc: scrapedDC,
      type: scrapedType
    };
  });

  const targetsFlag = message.getFlag(MODULE_ID, "targets");
  if (!targetsFlag) return; 

  const isGM = game.user.isGM;

  if (!isGM) {
    html.find(".apply-damage-btn").hide();
    html.find(".roll-all-npcs-btn").hide();
    if (!message.isAuthor) {
      html.find(".roll-damage-btn").hide();
    }
  }

  html.find(".roll-save-btn").each((index, element) => {
    const btn = $(element);
    const tokenId = element.dataset.tokenId;
    const token = canvas.tokens?.get(tokenId);

    if (!isGM) {
      if (!token || !token.actor?.isOwner) {
        btn.replaceWith('<span style="color: #777; font-style: italic; padding: 4px;">Awaiting...</span>');
      }
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
      } else if (rollResult.total !== undefined) {
        dRoll = rollResult;
      }
    } else {
      ui.notifications.info("AoE Easy Resolve | This item has no damage configured.");
      return;
    }

    if (!dRoll) return;

    if (useCustomDamage && game.dice3d) {
      await game.dice3d.showForRoll(dRoll, game.user, true);
    }

    const damageJSON = JSON.stringify(dRoll.toJSON());
    const damageTotal = dRoll.total;
    const damageFormula = dRoll.formula;

    let diceStrings = [];
    if (dRoll.dice && dRoll.dice.length > 0) {
      dRoll.dice.forEach(d => {
        diceStrings.push(`d${d.faces}: [${d.results.map(r => r.result).join(", ")}]`);
      });
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
      try {
        if (game.user.isGM || dmgMsg.isAuthor) await dmgMsg.delete();
      } catch(e) {}
    }

    if (game.user.isGM) {
      await message.update({
        [`flags.${MODULE_ID}.damageJSON`]: damageJSON,
        [`flags.${MODULE_ID}.damageTotal`]: damageTotal,
        [`flags.${MODULE_ID}.damageBreakdown`]: damageBreakdown,
        [`flags.${MODULE_ID}.damageFormula`]: damageFormula,
        [`flags.${MODULE_ID}.damageTooltip`]: damageTooltip
      });

      const freshMessage = game.messages.get(message.id);
      const freshAoeData = freshMessage.flags[MODULE_ID];
      const templatePath = `modules/${MODULE_ID}/templates/chat-card.hbs`;
      const formattedSaveType = freshAoeData.saveType.charAt(0).toUpperCase() + freshAoeData.saveType.slice(1);
      
      const newHtmlContent = await renderTemplate(templatePath, { 
        targets: formatTargetsData(freshAoeData.targets),
        itemName: freshAoeData.itemName,
        saveType: formattedSaveType,
        saveDC: freshAoeData.saveDC,
        damageTotal: damageTotal,
        damageBreakdown: damageBreakdown,
        damageFormula: damageFormula,
        damageTooltip: damageTooltip,
        isGM: game.user.isGM
      });
      
      await freshMessage.update({ content: newHtmlContent });
    } else {
      await ChatMessage.create({
        whisper: ChatMessage.getWhisperRecipients("GM"),
        blind: true,
        content: "AoE Easy Resolve Data Payload",
        flags: {
          [MODULE_ID]: {
            isSocketPayload: true,
            payload: {
              action: "updateDamageRoll",
              messageId: message.id,
              damageJSON: damageJSON,
              damageTotal: damageTotal,
              damageBreakdown: damageBreakdown,
              damageFormula: damageFormula,
              damageTooltip: damageTooltip
            }
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
      if (targetData.hasRolled) continue;
      const token = canvas.tokens.get(tokenId);
      if (token && token.actor && !token.actor.hasPlayerOwner) {
        npcsToRoll.push({ tokenId, token });
      }
    }
    
    if (npcsToRoll.length === 0) {
      ui.notifications.info("AoE Easy Resolve | No NPCs left to roll for.");
      return;
    }
    
    const updateData = {};
    
    for (const {tokenId, token} of npcsToRoll) {
      const rollOptions = { event: event, createMessage: false, skipDialog: true };
      if (saveDC) rollOptions.dc = { value: saveDC };
      
      const rollResult = await token.actor.saves[saveType].roll(rollOptions);
      if (!rollResult) continue;
      
      if (game.dice3d) {
        game.dice3d.showForRoll(rollResult, game.user, true);
      }
      
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
        hasRolled: true,
        rollTotal: rollResult.total,
        rollFormula: rollResult.formula,
        rollTooltip: rollTooltip,
        degreeOfSuccess: dos,
        unadjustedDegreeOfSuccess: unadjustedDos
      };
    }
    
    if (Object.keys(updateData).length > 0) {
        await message.update(updateData);
        
        const freshMessage = game.messages.get(message.id);
        const freshAoeData = freshMessage.flags[MODULE_ID];
        const templatePath = `modules/${MODULE_ID}/templates/chat-card.hbs`;
        const formattedSaveType = saveType.charAt(0).toUpperCase() + saveType.slice(1);
        
        const newHtmlContent = await renderTemplate(templatePath, { 
          targets: formatTargetsData(freshAoeData.targets), 
          itemName: freshAoeData.itemName,
          saveType: formattedSaveType,
          saveDC: saveDC,
          damageTotal: freshAoeData.damageTotal,
          damageBreakdown: freshAoeData.damageBreakdown,
          damageFormula: freshAoeData.damageFormula,
          isGM: game.user.isGM
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
        [updateKey]: {
          hasRolled: true,
          rollTotal: rollResult.total,
          rollFormula: rollResult.formula,
          rollTooltip: rollTooltip,
          degreeOfSuccess: dos,
          unadjustedDegreeOfSuccess: unadjustedDos
        } 
      });

      const freshMessage = game.messages.get(message.id);
      const freshAoeData = freshMessage.flags[MODULE_ID];
      const templatePath = `modules/${MODULE_ID}/templates/chat-card.hbs`;
      const formattedSaveType = saveType.charAt(0).toUpperCase() + saveType.slice(1);
      
      const newHtmlContent = await renderTemplate(templatePath, { 
        targets: formatTargetsData(freshAoeData.targets), 
        itemName: freshAoeData.itemName,
        saveType: formattedSaveType,
        saveDC: saveDC,
        damageTotal: freshAoeData.damageTotal,
        damageBreakdown: freshAoeData.damageBreakdown,
        damageFormula: freshAoeData.damageFormula,
        damageTooltip: freshAoeData.damageTooltip,
        isGM: game.user.isGM
      });
      
      await freshMessage.update({ content: newHtmlContent });
    } else {
      await ChatMessage.create({
        whisper: ChatMessage.getWhisperRecipients("GM"),
        blind: true,
        content: "AoE Easy Resolve Data Payload",
        flags: {
          [MODULE_ID]: {
            isSocketPayload: true,
            payload: {
              action: "updateSaveRoll",
              messageId: message.id,
              tokenId: tokenId,
              rollTotal: rollResult.total,
              rollFormula: rollResult.formula,
              rollTooltip: rollTooltip,
              dos: dos,
              unadjustedDos: unadjustedDos
            }
          }
        }
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
      try {
        pf2eDamageRoll = pf2eDamageClass.fromJSON(aoeData.damageJSON);
      } catch (e) {
        console.error("AoE Easy Resolve | Failed to parse DamageRoll JSON.", e);
      }
    }

    let originItem = null;
    if (aoeData.itemUuid) {
      try { originItem = await fromUuid(aoeData.itemUuid); } catch(e) {}
    }

    const aoeFlags = originItem?.flags?.[MODULE_ID] || {};
    const itemEffects = aoeFlags.effects || {};
    const itemMultipliers = aoeFlags.multipliers || {};
    
    let processedCount = 0;
    let needsDamageWarning = false;

    const itemHasDamage = (originItem?.system?.damage && Object.keys(originItem.system.damage).length > 0) || (aoeFlags.useCustomDamage && aoeFlags.customDamage) || aoeData.hazardDamage;
    
    if (itemHasDamage && !aoeData.damageTotal) {
      needsDamageWarning = true;
    }

    for (const [tokenId, targetData] of Object.entries(aoeData.targets)) {
      if (!targetData.hasRolled) continue; 

      const token = canvas.tokens.get(tokenId);
      if (!token || !token.actor) continue;

      const dos = targetData.degreeOfSuccess; 
      processedCount++; 

      if (aoeData.damageTotal) {
        let multiplier = 0;
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

        if (multiplier > 0) {
          try {
            if (token.actor.applyDamage) {
              await token.actor.applyDamage({
                damage: pf2eDamageRoll || Math.floor(aoeData.damageTotal * multiplier),
                token: token.document,
                item: originItem,
                multiplier: multiplier
              });
            } else {
              throw new Error("PF2e applyDamage API not found on actor.");
            }
          } catch (error) {
            console.warn(`AoE Easy Resolve | Native applyDamage failed for ${token.name}. Using raw HP reduction.`, error);
            try {
              const finalDamage = Math.floor(aoeData.damageTotal * multiplier);
              const currentHP = token.actor.system.attributes.hp.value;
              await token.actor.update({ "system.attributes.hp.value": Math.max(0, currentHP - finalDamage) });
            } catch (fallbackError) {
              console.error(`AoE Easy Resolve | Raw HP reduction failed for ${token.name}`, fallbackError);
            }
          }
        }
      }

      const effectUuid = itemEffects[dos];
      if (effectUuid && effectUuid.trim() !== "") {
        try {
          const effectDoc = await fromUuid(effectUuid.trim());
          if (effectDoc) {
            await token.actor.createEmbeddedDocuments("Item", [effectDoc.toObject()]);
          }
        } catch (error) {
          console.error(`AoE Easy Resolve | Failed to apply effect UUID: ${effectUuid}`, error);
        }
      }
    }

    if (processedCount > 0) {
      if (needsDamageWarning) {
        ui.notifications.warn("AoE Easy Resolve | Processed saves, but you forgot to click 'Roll Damage' first!");
      } else {
        ui.notifications.info(`AoE Easy Resolve | Processed damage and effects for ${processedCount} targets.`);
      }
    } else {
      ui.notifications.warn("AoE Easy Resolve | No targets have rolled saves yet.");
    }

    if (game.user.isGM && aoeData.templateId) {
      const templateExists = canvas.templates.get(aoeData.templateId);
      if (templateExists) {
        new Dialog({
          title: "Remove Template?",
          content: "<p>Do you want to remove the measured template from the canvas?</p>",
          buttons: {
            yes: {
              icon: '<i class="fas fa-trash"></i>',
              label: "Yes",
              callback: async () => {
                try {
                  await canvas.scene.deleteEmbeddedDocuments("MeasuredTemplate", [aoeData.templateId]);
                  ui.notifications.info("AoE Easy Resolve | Template removed.");
                } catch(e) {}
              }
            },
            no: {
              icon: '<i class="fas fa-times"></i>',
              label: "No"
            }
          },
          default: "yes"
        }).render(true);
      }
    }
  });
});

async function generateTemplateCard(templateObj, templateDoc, cfg) {
    const targetedTokens = canvas.tokens.placeables.filter(token => {
      const center = token.center;
      return templateObj.shape.contains(center.x - templateDoc.x, center.y - templateDoc.y);
    });
  
    if (targetedTokens.length === 0) {
      ui.notifications.info("AoE Easy Resolve | No tokens caught in the blast area.");
      return;
    }
  
    const targetsData = {};
    targetedTokens.forEach(t => {
      targetsData[t.id] = { id: t.id, name: t.name, img: t.document.texture.src, hasRolled: false, rollTotal: null, degreeOfSuccess: null };
    });
  
    const templatePath = `modules/${MODULE_ID}/templates/chat-card.hbs`;
    const formattedSaveType = cfg.saveType.charAt(0).toUpperCase() + cfg.saveType.slice(1);
    
    const htmlContent = await renderTemplate(templatePath, { 
      targets: formatTargetsData(targetsData), 
      itemName: cfg.itemName,
      saveType: formattedSaveType,
      saveDC: cfg.saveDC,
      damageTotal: null,
      damageBreakdown: null,
      damageTooltip: null,
      damageFormula: null,
      isGM: game.user.isGM
    });
  
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker(),
      content: htmlContent,
      flags: {
        [MODULE_ID]: {
          templateId: templateDoc.id,
          itemUuid: cfg.originItem ? cfg.originItem.uuid : null,
          itemName: cfg.itemName,
          saveType: cfg.saveType,
          saveDC: cfg.saveDC,
          isBasicSave: cfg.isBasicSave,
          targets: targetsData,
          hazardDamage: cfg.hazardDamage || null
        }
      }
    });
  }
  
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
                icon: '<i class="fas fa-bolt"></i>',
                label: "Create Save Card",
                callback: async (html) => {
                  await generateTemplateCard(templateObj, templateDoc, {
                    itemName: html.find("#hazName").val() || "Environmental Hazard",
                    saveType: html.find("#hazSave").val(),
                    saveDC: parseInt(html.find("#hazDC").val(), 10) || null,
                    isBasicSave: true,
                    originItem: null,
                    hazardDamage: html.find("#hazDam").val() || null
                  });
                }
              },
              cancel: { icon: '<i class="fas fa-times"></i>', label: "Ignore" }
            },
            default: "create"
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
        }
  
        await generateTemplateCard(templateObj, templateDoc, {
          itemName: cache.name,
          saveType: saveType,
          saveDC: saveDC,
          isBasicSave: isBasicSave,
          originItem: originItem,
          hazardDamage: null
        });
  
      } catch (err) {
        console.error(`${MODULE_ID} | Error generating template chat card:`, err);
      }
    }, 150); 
  });