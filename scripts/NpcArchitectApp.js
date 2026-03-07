import { updateNpcStats } from "./NpcDataModel.js";

export class NpcArchitectApp extends FormApplication {
    
    constructor(actor) {
        super();
        this.actor = actor;
        this._editingArchetype = null; 
    }

    static get defaultOptions() {
        return mergeObject(super.defaultOptions, {
            id: "pf2e-npc-architect-app",
            title: "NPC Architect",
            template: "modules/pf2e-npc-architect/templates/hub-shell.hbs",
            width: 800,
            height: "auto",
            resizable: true,
            classes: ["pf2e-npc-architect"],
            submitOnChange: true,
            closeOnSubmit: false,
            tabs: [{ navSelector: ".architect-nav", contentSelector: ".architect-body", initial: "dossier" }]
        });
    }

    getData() {
        const data = super.getData();
        const flags = this.actor.getFlag("pf2e-npc-architect", "data") || {};
        
        data.actor = this.actor;
        data.tracked = flags.tracked || false;
        data.isLocation = flags.isLocation || false;
        data.campaign = flags.campaign || "Global";
        data.faction = flags.faction || "";


        data.affiliations = {
            "Allied": "Allied",
            "Friendly": "Friendly",
            "Neutral": "Neutral",
            "Dislike": "Dislike",
            "Enemy": "Enemy",
            "Unknown": "???"
        };

        let rawAff = flags.affiliation;
        if (Array.isArray(rawAff)) rawAff = rawAff[0];
        rawAff = String(rawAff || "").trim();

        let currentAff = "Neutral";
        if (data.affiliations[rawAff]) {
            currentAff = rawAff;
        } else {
            const num = parseInt(rawAff) || 0;
            if (num >= 80) currentAff = "Allied";
            else if (num >= 30) currentAff = "Friendly";
            else if (num <= -80) currentAff = "Enemy";
            else if (num <= -30) currentAff = "Dislike";
        }
        data.affiliationStatus = currentAff;

        const customArchetypes = game.settings.get("pf2e-npc-architect", "customArchetypes") || {};
        data.savedArchetypes = customArchetypes;
        data.roles = {
            "soldier": "Soldier / Brute",
            "skirmisher": "Skirmisher / Rogue",
            "caster": "Spellcaster",
            "boss": "Boss",
            ...Object.keys(customArchetypes).reduce((acc, id) => {
                acc[id] = customArchetypes[id].name;
                return acc;
            }, {})
        };

        data.currentRole = flags.role || "soldier";
        data.bioPublic = flags.bioPublic || "";
        data.bioSecret = flags.bioSecret || ""; 

     
        let eligibleActors = [];
        game.actors.forEach(a => {
            if (a.id === this.actor.id) return; 
            const isPC = a.type === "character";
            const isTracked = a.getFlag("pf2e-npc-architect", "data")?.tracked;
            
            if (isPC || isTracked) {
                eligibleActors.push({ id: a.id, name: a.name });
            }
        });
        
        eligibleActors.sort((a, b) => a.name.localeCompare(b.name));
        data.availableActors = eligibleActors.reduce((acc, a) => {
            acc[a.id] = a.name;
            return acc;
        }, {});

        data.connections = flags.connections || [];
        
        return data;
    }

    async _updateObject(event, formData) {
        if (!event.target || !event.target.closest('#builder-editor')) {
            formData.tracked = !!formData.tracked;
            formData.isLocation = !!formData.isLocation; 
            
            let camp = Array.isArray(formData.campaign) ? formData.campaign[0] : formData.campaign;
            let fac = Array.isArray(formData.faction) ? formData.faction[0] : formData.faction;
            let aff = Array.isArray(formData.affiliation) ? formData.affiliation[0] : formData.affiliation;

            formData.campaign = String(camp || "Global").trim();
            formData.faction = String(fac || "").trim();
            formData.affiliation = String(aff || "Neutral").trim();
            const connections = [];
            this.element.find('.connection-row').each((i, row) => {
                const id = $(row).find('.conn-id').val();
                const label = $(row).find('.conn-label').val().trim();
                const isSecret = $(row).find('.conn-secret').is(':checked'); 
                
                if (id && label) {
                    connections.push({ id: id, label: label, secret: isSecret });
                }
            });
            formData.connections = connections;
            
            await this.actor.setFlag("pf2e-npc-architect", "data", formData);
            
            const dossier = Object.values(ui.windows).find(w => w.id === "npc-dossier-hub");
            if (dossier) dossier.render(false);
        }
    }

    activateListeners(html) {
        super.activateListeners(html);

        html.find('.apply-scaling-btn').click(async (event) => {
            event.preventDefault(); 
            const formElement = this.element.find("form")[0];
            const formData = new FormDataExtended(formElement).object;
            await updateNpcStats(this.actor, parseInt(formData.targetLevel), formData.role);
            await this.actor.setFlag("pf2e-npc-architect", "data", { role: formData.role, targetLevel: parseInt(formData.targetLevel) });
            this.render();
        });

        const archetypeSelect = html.find('#archetype-select');
        const editorDiv = html.find('#builder-editor');

        archetypeSelect.on('change', (ev) => {
            const val = ev.target.value;
            if (val === "new") {
                this._createNewArchetype();
            } else if (val) {
                this._loadArchetype(val);
            } else {
                editorDiv.slideUp();
                this._editingArchetype = null;
            }
        });

        html.find('.save-archetype-btn').click(async () => {
            if (!this._editingArchetype) return;
            await this._saveCurrentArchetype(html);
        });

        html.find('.add-connection-btn').click(ev => {
            let actorsObj = [];
            game.actors.forEach(a => {
                if (a.id === this.actor.id) return;
                if (a.type === "character" || a.getFlag("pf2e-npc-architect", "data")?.tracked) {
                    actorsObj.push({id: a.id, name: a.name});
                }
            });
            actorsObj.sort((a,b) => a.name.localeCompare(b.name));
            let optionsHtml = actorsObj.map(a => `<option value="${a.id}">${a.name}</option>`).join("");

            const newRow = `
                <div class="connection-row" style="display:flex; gap:10px; margin-bottom: 8px; align-items:center;">
                    <select class="conn-id" style="flex: 1;">
                        <option value="">-- Select Actor --</option>
                        ${optionsHtml}
                    </select>
                    <input type="text" class="conn-label" placeholder="e.g. Brother, Sworn Rival" style="flex: 1;">
                    <button type="button" class="remove-connection-btn" style="flex: 0 0 30px; padding:0; height:30px;"><i class="fas fa-trash"></i></button>
                </div>
            `;
            html.find('#connections-list').append(newRow);
            
            html.find('.remove-connection-btn').off('click').click(e => {
                $(e.currentTarget).closest('.connection-row').remove();
            });
        });

        html.find('.remove-connection-btn').click(e => {
            $(e.currentTarget).closest('.connection-row').remove();
            this.element.find("form").submit();
        });
    }

    _createNewArchetype() {
        this._editingArchetype = {
            id: foundry.utils.randomID(),
            name: "New Class",
            isCaster: false,
            tradition: "arcane",
            levels: Array.from({length: 20}, (_, i) => ({
                level: i + 1,
                hp: "mod", ac: "mod",
                fort: "mod", ref: "mod", will: "mod", per: "mod",
                items: []
            }))
        };
        this._renderBuilderUI();
    }

    _loadArchetype(id) {
        const saved = game.settings.get("pf2e-npc-architect", "customArchetypes");
        const loaded = saved[id] ? foundry.utils.deepClone(saved[id]) : null;
        if (loaded) {
            loaded.levels = loaded.levels.map(l => ({
                ...l, fort: l.fort || "mod", ref: l.ref || "mod", will: l.will || "mod", per: l.per || "mod"
            }));
        }
        this._editingArchetype = loaded;
        this._renderBuilderUI();
    }

    _renderBuilderUI() {
        if (!this._editingArchetype) return;
        
        const html = this.element;
        const editor = html.find('#builder-editor');
        const container = html.find('.level-container');
        
        html.find('#arch-name').val(this._editingArchetype.name);
        
        const isCasterCheck = html.find('#arch-iscaster');
        const tradSelect = html.find('#arch-tradition');
        
        isCasterCheck.prop('checked', this._editingArchetype.isCaster || false);
        tradSelect.val(this._editingArchetype.tradition || "arcane");
        tradSelect.toggle(this._editingArchetype.isCaster || false);

        isCasterCheck.off('change').change(ev => {
            tradSelect.toggle(ev.target.checked);
        });

        const makeSelect = (cls, val) => `
            <select class="${cls}" style="font-size:0.8em; height:20px; padding:0; background: rgba(255,255,255,0.9); color: #111; border: 1px solid #444;">
                <option value="high" ${val === 'high' ? 'selected' : ''}>High</option>
                <option value="mod" ${val === 'mod' ? 'selected' : ''}>Mod</option>
                <option value="low" ${val === 'low' ? 'selected' : ''}>Low</option>
            </select>`;

        let rows = "";
        this._editingArchetype.levels.forEach(lvl => {
            let itemsHtml = lvl.items.map(item => {

                const rankInput = item.type === "spell" 
                    ? `<input type="number" class="item-rank-input" data-level="${lvl.level}" data-uuid="${item.uuid}" value="${item.rank || ''}" placeholder="Rnk" min="1" max="10" title="Heighten to Rank" style="width: 36px; height: 16px; font-size: 0.8em; padding: 0 2px; margin-left: 5px; color: black; background: #fff; border: none; border-radius: 2px;">` 
                    : "";

                return `
                <span class="item-tag" style="background:#4b4a44; color:#fff; padding:2px 5px; border-radius:3px; font-size:0.8em; margin-right:5px; display:inline-block; margin-bottom: 2px;">
                    <img src="${item.img}" width="16" height="16" style="vertical-align:middle; border:none;"> ${item.name}
                    ${rankInput}
                    <i class="fas fa-times delete-item-btn" data-uuid="${item.uuid}" style="cursor:pointer; margin-left:5px; color:#ff8888;"></i>
                </span>`;
            }).join("");

            rows += `
            <div class="level-row flexrow" data-level="${lvl.level}" style="padding:4px; border-bottom:1px solid #444; align-items:center;">
                <div style="flex:0 0 30px; text-align:center; font-weight:bold; color: #e0e0e0;">${lvl.level}</div>
                <div style="flex:0 0 45px;">${makeSelect('hp-select', lvl.hp)}</div>
                <div style="flex:0 0 45px;">${makeSelect('ac-select', lvl.ac)}</div>
                <div style="flex:0 0 45px;">${makeSelect('fort-select', lvl.fort)}</div>
                <div style="flex:0 0 45px;">${makeSelect('ref-select', lvl.ref)}</div>
                <div style="flex:0 0 45px;">${makeSelect('will-select', lvl.will)}</div>
                <div style="flex:0 0 45px;">${makeSelect('per-select', lvl.per)}</div>
                <div class="drop-zone" style="flex:1; min-height:24px; background:rgba(255,255,255,0.05); border-radius:3px; padding:2px; margin-left:5px; border: 1px dashed #555;">
                    ${itemsHtml || '<span style="color:#888; font-style:italic; font-size:0.8em;">Drag items/spells here</span>'}
                </div>
            </div>`;
        });

        container.html(rows);

        editor.show();
        this.setPosition({ height: "auto" });

        container.find('.delete-item-btn').click((ev) => {
            const level = $(ev.currentTarget).closest('.level-row').data('level');
            const uuid = $(ev.currentTarget).data('uuid');
            this._removeItemFromLevel(level, uuid);
        });

        container.find('.item-rank-input').change(ev => {
            const level = $(ev.currentTarget).data('level');
            const uuid = $(ev.currentTarget).data('uuid');
            const val = $(ev.currentTarget).val();
            const lvlObj = this._editingArchetype.levels.find(l => l.level === level);
            if (lvlObj) {
                const item = lvlObj.items.find(i => i.uuid === uuid);
                if (item) item.rank = val;
            }
        });

        const dropZones = container.find('.level-row');
        dropZones.on('dragover', (ev) => ev.preventDefault()); 
        dropZones.on('drop', (ev) => this._onManualDrop(ev));
    }

    async _saveCurrentArchetype(html) {
        this._editingArchetype.name = html.find('#arch-name').val();
        this._editingArchetype.isCaster = html.find('#arch-iscaster').is(':checked');
        this._editingArchetype.tradition = html.find('#arch-tradition').val();
        
        html.find('.level-row').each((i, row) => {
            const level = $(row).data('level');
            const hp = $(row).find('.hp-select').val();
            const ac = $(row).find('.ac-select').val();
            const fort = $(row).find('.fort-select').val();
            const ref = $(row).find('.ref-select').val();
            const will = $(row).find('.will-select').val();
            const per = $(row).find('.per-select').val();

            const lvlObj = this._editingArchetype.levels.find(l => l.level === level);
            if (lvlObj) {
                lvlObj.hp = hp; lvlObj.ac = ac; lvlObj.fort = fort; lvlObj.ref = ref; lvlObj.will = will; lvlObj.per = per;
            }
        });

        const allArchetypes = game.settings.get("pf2e-npc-architect", "customArchetypes");
        allArchetypes[this._editingArchetype.id] = this._editingArchetype;
        await game.settings.set("pf2e-npc-architect", "customArchetypes", allArchetypes);
        
        ui.notifications.info(`Saved Archetype: ${this._editingArchetype.name}`);
        this.render(); 
    }

    _removeItemFromLevel(level, uuid) {
        if (!this._editingArchetype) return;
        const lvlObj = this._editingArchetype.levels.find(l => l.level === level);
        if (lvlObj) {
            lvlObj.items = lvlObj.items.filter(i => i.uuid !== uuid);
            this._renderBuilderUI(); 
        }
    }

    async _onManualDrop(event) {
        event.preventDefault();
        let data;
        try { data = JSON.parse(event.originalEvent.dataTransfer.getData('text/plain')); } catch (err) { return; }
        if (data.type !== "Item") return;

        const row = $(event.currentTarget).closest(".level-row");
        const level = row.data('level');
        const item = await fromUuid(data.uuid);
        if (!item) return;

        const lvlObj = this._editingArchetype.levels.find(l => l.level === level);
        if (lvlObj) {
            if (!lvlObj.items.find(i => i.uuid === data.uuid)) {
                lvlObj.items.push({ name: item.name, img: item.img, uuid: data.uuid, type: item.type });
                this._renderBuilderUI();
            }
        }
    }
}