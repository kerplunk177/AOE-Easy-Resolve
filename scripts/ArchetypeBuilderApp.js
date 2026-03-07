export class ArchetypeBuilderApp extends FormApplication {
    constructor(archetypeId = null) {
        super();
        this.archetypeId = archetypeId;
        const savedArchetypes = game.settings.get("pf2e-npc-architect", "customArchetypes") || {};
        this.data = archetypeId ? savedArchetypes[archetypeId] : {
            name: "New Archetype",
            levels: Array.from({length: 20}, (_, i) => ({
                level: i + 1,
                hp: "mod", 
                ac: "mod", 
                items: []  
            }))
        };
    }

    static get defaultOptions() {
        return mergeObject(super.defaultOptions, {
            id: "archetype-builder",
            title: "Archetype Builder",
            template: "modules/pf2e-npc-architect/templates/builder-shell.hbs",
            width: 800,
            height: 700,
            classes: ["pf2e-npc-architect"],
            resizable: true,
            dragDrop: [{ dragSelector: ".item-list .item", dropSelector: ".level-row" }]
        });
    }

    getData() {
        return {
            archetype: this.data,
            mathOptions: { "high": "High", "mod": "Moderate", "low": "Low" }
        };
    }

    async _updateObject(event, formData) {

        console.log("Saving Archetype...", formData);
    }


    async _onDrop(event) {
        const data = TextEditor.getDragEventData(event);
        if (data.type !== "Item") return;

        const row = event.target.closest(".level-row");
        if (!row) return;
        const levelIndex = row.dataset.level - 1;


        const item = await fromUuid(data.uuid);
        
 
        this.data.levels[levelIndex].items.push({
            name: item.name,
            img: item.img,
            uuid: data.uuid
        });

        this.render();
    }
}