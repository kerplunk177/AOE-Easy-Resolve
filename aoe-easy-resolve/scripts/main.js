console.log("AoE Easy Resolve | Script loaded successfully.");

const MODULE_ID = "aoe-easy-resolve";
window.aoeEasyResolveCache = null;
window.aoeEasyResolveQueue = Promise.resolve();
// NEW: Helper function to inject colors and labels for the UI
function formatTargetsData(targets) {
    const result = {};
    for (const [id, t] of Object.entries(targets || {})) {
      let dosColor = "inherit";
      let dosLabel = "";
      if (t.degreeOfSuccess === "criticalSuccess") { dosColor = "rgb(0, 128, 0)"; dosLabel = "Crit Success"; }
      else if (t.degreeOfSuccess === "success") { dosColor = "rgb(0, 0, 255)"; dosLabel = "Success"; }
      else if (t.degreeOfSuccess === "failure") { dosColor = "rgb(255, 69, 0)"; dosLabel = "Failure"; }
      else if (t.degreeOfSuccess === "criticalFailure") { dosColor = "rgb(255, 0, 0)"; dosLabel = "Crit Fail"; }
      result[id] = { ...t, dosColor, dosLabel };
    }
    return result;
  }

// ==========================================
// 1. INITIALIZATION & WHISPER ROUTER
// ==========================================
Hooks.once("init", async function () {
  console.log(`${MODULE_ID} | Initializing module`);
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
            degreeOfSuccess: data.dos
          } 
        });
      } else if (data.action === "updateDamageRoll") {
        await targetMessage.update({
          [`flags.${MODULE_ID}.damageJSON`]: data.damageJSON,
          [`flags.${MODULE_ID}.damageTotal`]: data.damageTotal,
          [`flags.${MODULE_ID}.damageFormula`]: data.damageFormula
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
        damageFormula: freshAoeData.damageFormula,
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

// ==========================================
// 2. ITEM CONFIGURATION UI
// ==========================================
Hooks.on("renderItemSheet", async (app, html, data) => {
    if (!["spell", "feat", "action", "consumable", "weapon", "equipment"].includes(app.item.type)) return;
  
    const templatePath = `modules/${MODULE_ID}/templates/item-config.hbs`;
    const flags = app.item.flags[MODULE_ID] || {};
  
    // Dynamically pull PF2e Damage Types and format them for the dropdown
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
  
    // Re-apply the scroll position now that the DOM has expanded to its true height
    if (typeof app._restoreScrollPositions === "function") {
      app._restoreScrollPositions(html);
    }
  });

// ==========================================
// 3. CHAT MESSAGE & BUTTON LISTENERS
// ==========================================
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

  // Roll Damage Button
  html.find(".roll-damage-btn").click(async (event) => {
    event.preventDefault();
    const aoeData = message.flags[MODULE_ID];
    
    let originItem = null;
    if (aoeData.itemUuid) originItem = await fromUuid(aoeData.itemUuid);

    const aoeFlags = originItem?.flags?.[MODULE_ID] || {};
    const useCustomDamage = aoeFlags.useCustomDamage;
    const customDamageFormula = aoeFlags.customDamage;
    const customDamageType = aoeFlags.customDamageType;

    let dRoll = null;
    let dmgMsg = null;

    if (useCustomDamage && customDamageFormula) {
      const pf2eDamageClass = CONFIG.Dice.rolls.find(r => r.name === "DamageRoll") || Roll;
      try {
        // Safely format the formula, appending the damage type bracket if one is selected
        const fullFormula = customDamageType ? `(${customDamageFormula})[${customDamageType}]` : customDamageFormula;
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

    if (dmgMsg && typeof dmgMsg.delete === "function") {
      try {
        if (game.user.isGM || dmgMsg.isAuthor) await dmgMsg.delete();
      } catch(e) {}
    }

    if (game.user.isGM) {
      await message.update({
        [`flags.${MODULE_ID}.damageJSON`]: damageJSON,
        [`flags.${MODULE_ID}.damageTotal`]: damageTotal,
        [`flags.${MODULE_ID}.damageFormula`]: damageFormula
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
        damageFormula: damageFormula,
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
              damageFormula: damageFormula
            }
          }
        }
      });
    }
  });

  // Roll ALL NPCs Button
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
      // Ensure the token exists and does not have a player owner
      if (token && token.actor && !token.actor.hasPlayerOwner) {
        npcsToRoll.push({ tokenId, token });
      }
    }
    
    if (npcsToRoll.length === 0) {
      ui.notifications.info("AoE Easy Resolve | No NPCs left to roll for.");
      return;
    }
    
    const updateData = {};
    
    // Process each NPC
    for (const {tokenId, token} of npcsToRoll) {
      // skipDialog ensures we don't get 5 popups for 5 goblins
      const rollOptions = { event: event, createMessage: false, skipDialog: true };
      if (saveDC) rollOptions.dc = { value: saveDC };
      
      const rollResult = await token.actor.saves[saveType].roll(rollOptions);
      if (!rollResult) continue;
      
      // Deliberately omitting "await" here so all dice roll on the screen simultaneously
      if (game.dice3d) {
        game.dice3d.showForRoll(rollResult, game.user, true);
      }
      
      let dos = "success"; 
      if (rollResult.options && rollResult.options.degreeOfSuccess !== undefined) {
        const dosMap = { 0: "criticalFailure", 1: "failure", 2: "success", 3: "criticalSuccess" };
        dos = dosMap[rollResult.options.degreeOfSuccess] || dos;
      }
      
      updateData[`flags.${MODULE_ID}.targets.${tokenId}`] = {
        hasRolled: true,
        rollTotal: rollResult.total,
        rollFormula: rollResult.formula,
        degreeOfSuccess: dos
      };
    }
    
    // Batch update the database once at the end
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
        damageFormula: freshAoeData.damageFormula,
        isGM: game.user.isGM
      });
      
      await freshMessage.update({ content: newHtmlContent });
    }
  });

  // Roll Save Button (Individual)
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

    let dos = "success"; 
    if (rollResult.options && rollResult.options.degreeOfSuccess !== undefined) {
      const dosMap = { 0: "criticalFailure", 1: "failure", 2: "success", 3: "criticalSuccess" };
      dos = dosMap[rollResult.options.degreeOfSuccess] || dos;
    }
  
    if (game.user.isGM) {
      const updateKey = `flags.${MODULE_ID}.targets.${tokenId}`;
      await message.update({ 
        [updateKey]: {
          hasRolled: true,
          rollTotal: rollResult.total,
          rollFormula: rollResult.formula,
          degreeOfSuccess: dos
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
        damageFormula: freshAoeData.damageFormula,
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
              dos: dos
            }
          }
        }
      });
    }
  });

  // Apply Damage & Effects Button
  html.find(".apply-damage-btn").click(async (event) => {
    event.preventDefault();

    const freshMessage = game.messages.get(message.id);
    const aoeData = freshMessage.flags[MODULE_ID];
    if (!aoeData || !aoeData.targets) return;

    let pf2eDamageRoll = null;
    if (aoeData.damageJSON) {
      try {
        pf2eDamageRoll = Roll.fromJSON(aoeData.damageJSON);
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

    const itemHasDamage = (originItem?.system?.damage && Object.keys(originItem.system.damage).length > 0) || (aoeFlags.useCustomDamage && aoeFlags.customDamage);
    
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

// ==========================================
// 4. TEMPLATE GENERATION
// ==========================================
Hooks.on("createMeasuredTemplate", async (templateDoc, options, userId) => {
  if (game.user.id !== userId) return;

  setTimeout(async () => {
    const templateObj = canvas.templates.get(templateDoc.id) || templateDoc.object;
    if (!templateObj || !templateObj.shape) return;

    const cache = window.aoeEasyResolveCache;
    window.aoeEasyResolveCache = null; 

    let itemName = "AoE Effects";
    let saveType = "reflex";
    let saveDC = null;
    let originItem = null;
    let isBasicSave = true;

    if (cache) {
      originItem = cache.item;
      
      // KILL SWITCH: If Ignore AoE is checked, abort drawing the chat card immediately
      if (originItem?.flags?.[MODULE_ID]?.ignoreAoE) return;

      itemName = cache.name;
      saveType = cache.type;
      saveDC = cache.dc;

      if (originItem) {
        isBasicSave = originItem.system?.defense?.save?.basic ?? true;

        const aoeFlags = originItem.flags?.[MODULE_ID];
        if (aoeFlags && aoeFlags.useOverride) {
          saveType = aoeFlags.saveType || saveType;
          saveDC = aoeFlags.saveDC || saveDC;
        }
      }
    }

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
      targetsData[t.id] = {
        id: t.id,
        name: t.name,
        img: t.document.texture.src,
        hasRolled: false,
        rollTotal: null,
        degreeOfSuccess: null
      };
    });

    const templatePath = `modules/${MODULE_ID}/templates/chat-card.hbs`;
    const formattedSaveType = saveType.charAt(0).toUpperCase() + saveType.slice(1);
    
    const htmlContent = await renderTemplate(templatePath, { 
        targets: formatTargetsData(targetsData),
      itemName: itemName,
      saveType: formattedSaveType,
      saveDC: saveDC,
      isGM: game.user.isGM
    });

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker(),
      content: htmlContent,
      flags: {
        [MODULE_ID]: {
          templateId: templateDoc.id,
          itemUuid: originItem ? originItem.uuid : null,
          itemName: itemName,
          saveType: saveType,
          saveDC: saveDC,
          isBasicSave: isBasicSave,
          targets: targetsData
        }
      }
    });

  }, 150); 
});