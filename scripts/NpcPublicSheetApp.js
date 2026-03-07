export class NpcPublicSheetApp extends FormApplication {
    constructor(actor, options) {
        super(actor, options);
        this.actor = actor; 
        const savedPos = game.user?.getFlag("pf2e-npc-architect", "publicSheetBounds");
        if (savedPos) {
            this.position.width = savedPos.width;
            this.position.height = savedPos.height;
            this.position.left = savedPos.left;
            this.position.top = savedPos.top;
        }
    }

    static get defaultOptions() {
        return mergeObject(super.defaultOptions, {
            title: "NPC File",
            template: "modules/pf2e-npc-architect/templates/public-sheet.hbs",
            width: 700,
            height: 650,
            classes: ["npc-architect", "public-sheet"],
            submitOnChange: true,
            closeOnSubmit: false,
            resizable: true
        });
    }
    async close(options) {
        await game.user.setFlag("pf2e-npc-architect", "publicSheetBounds", {
            width: this.position.width,
            height: this.position.height,
            left: this.position.left,
            top: this.position.top
        });
        return super.close(options);
    }

    get id() {
        return `public-sheet-${this.actor.id}-${game.user.id}`;
    }

    getData() {
        const flags = this.actor.getFlag("pf2e-npc-architect", "data") || {};
        const isMystified = this.actor.getFlag("pf2e-npc-architect", "mystified") || false;
        
        let rawAff = String(flags.affiliation || "").trim();
        let affLabel = "Neutral";
        let affClass = "neutral";
        const validAffs = ["Allied", "Friendly", "Neutral", "Dislike", "Enemy", "Unknown"];
        
        if (validAffs.includes(rawAff)) {
            affLabel = rawAff === "Unknown" ? "???" : rawAff;
            affClass = rawAff.toLowerCase();
        } else {
            const num = parseInt(rawAff) || 0;
            if (num >= 80) { affLabel = "Allied"; affClass = "allied"; }
            else if (num >= 30) { affLabel = "Friendly"; affClass = "friendly"; }
            else if (num <= -80) { affLabel = "Enemy"; affClass = "enemy"; }
            else if (num <= -30) { affLabel = "Dislike"; affClass = "dislike"; }
        }

        const notesJournal = game.journal.getName("NPC Dossier Shared Notes");
        let rawNotes = notesJournal ? (notesJournal.getFlag("pf2e-npc-architect", `notes_${this.actor.id}`) || []) : [];
        
        let notesArray = [];
        if (typeof rawNotes === "string") {
            if (rawNotes.trim() !== "") {
                notesArray.push({ id: "legacy-note", userId: "legacy", text: rawNotes, time: Date.now() });
            }
        } else if (Array.isArray(rawNotes)) {
            notesArray = rawNotes;
        }

        const formattedNotes = notesArray.map(n => {
            let authorName = "Archived Note";
            let cssColor = "#777777";
            
            if (n.userId !== "legacy") {
                const author = game.users.get(n.userId);
                if (author) {
                    authorName = author.name;
                    cssColor = author.color?.css || author.color || "#777777"; 
                }
            }
            
            const date = new Date(n.time);
            const isAuthor = n.userId === game.user.id;
            const isGM = game.user.isGM;

            return {
                id: n.id || n.time, 
                text: n.text,
                authorName: authorName,
                color: cssColor,
                timestamp: `${date.toLocaleDateString()} ${date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`,
                canEdit: isAuthor || isGM || n.userId === "legacy" 
            };
        });

        const connectionsRaw = flags.connections || [];
        const resolvedConnections = [];
        for (let conn of connectionsRaw) {
            if (conn.secret && !game.user.isGM) continue;

            const linkedActor = game.actors.get(conn.id);
            if (linkedActor) {
                const linkedFlags = linkedActor.getFlag("pf2e-npc-architect", "data") || {};
                const linkedFaction = String(linkedFlags.faction || "").trim().toLowerCase();
        
                if (linkedFaction === "hidden" && !game.user.isGM) continue;

                const connMystified = linkedActor.getFlag("pf2e-npc-architect", "mystified") || false;
                
                let displayImg = linkedActor.img;
                if (!game.user.isGM && connMystified) {
                    displayImg = "icons/svg/mystery-man.svg";
                }
                resolvedConnections.push({
                    id: linkedActor.id,
                    name: linkedActor.name,
                    img: displayImg,
                    label: conn.label,
                    isSecret: conn.secret
                });
            }
        }

        return {
            actor: this.actor,
            isGM: game.user.isGM,
            isMystified: isMystified,
            displayImage: isMystified ? "icons/svg/mystery-man.svg" : this.actor.img,
            faction: flags.faction || "Unaligned",
            affiliation: affLabel,
            affClass: affClass,
            bioPublic: flags.bioPublic || "",
            partyNotesList: formattedNotes.reverse(), 
            connections: resolvedConnections,
            isLocation: flags.isLocation || false,
        };
    }

    activateListeners(html) {
        super.activateListeners(html);

        html.find('.mystify-toggle').click(async (ev) => {
            ev.preventDefault();
            const currentStatus = this.actor.getFlag("pf2e-npc-architect", "mystified") || false;
            await this.actor.setFlag("pf2e-npc-architect", "mystified", !currentStatus);
            this.render(false);
            
            const dossier = Object.values(ui.windows).find(w => w.id === "npc-dossier-hub");
            if (dossier) dossier.render(false);
        });

        html.find('.profile-img').click(ev => {
            const src = $(ev.currentTarget).attr('src');
            const isMystified = this.actor.getFlag("pf2e-npc-architect", "mystified") || false;
            new ImagePopout(src, {
                title: isMystified ? "Unknown Entity" : this.actor.name,
                uuid: this.actor.uuid
            }).render(true);
        });

        html.find('.connection-item').click(ev => {
            const targetId = ev.currentTarget.dataset.id;
            const targetActor = game.actors.get(targetId);
            if (targetActor) {
                new this.constructor(targetActor).render(true);
            }
        });


        const getNotesData = () => {
            const notesJournal = game.journal.getName("NPC Dossier Shared Notes");
            if (!notesJournal) return null;
            let rawNotes = notesJournal.getFlag("pf2e-npc-architect", `notes_${this.actor.id}`) || [];

if (typeof rawNotes === "string") {

   if (rawNotes.trim() !== "") {
       notesArray.push({ id: "legacy-note", userId: "legacy", text: rawNotes, time: Date.now() });
   }
}
            return { journal: notesJournal, notes: rawNotes };
        };

        const postNote = async () => {
            const inputField = html.find('.new-note-input');
            const text = inputField.val().trim();
            if (!text) return;

            const data = getNotesData();
            if (!data) return ui.notifications.warn("NPC Architect: Shared journal missing.");

            data.notes.push({
                id: foundry.utils.randomID(),
                userId: game.user.id,
                text: text,
                time: Date.now()
            });

            await data.journal.setFlag("pf2e-npc-architect", `notes_${this.actor.id}`, data.notes);
            this.render(false);
        };

        html.find('.post-note-btn').click(ev => { ev.preventDefault(); postNote(); });
        html.find('.new-note-input').keydown(ev => {
            if (ev.key === "Enter" && !ev.shiftKey) {
                ev.preventDefault();
                postNote();
            }
        });

        html.find('.delete-note-btn').click(async ev => {
            const noteId = String($(ev.currentTarget).data('id'));
            const data = getNotesData();
            if (!data) return;

            const newNotes = data.notes.filter(n => String(n.id || n.time) !== noteId);
            await data.journal.setFlag("pf2e-npc-architect", `notes_${this.actor.id}`, newNotes);
            this.render(false);
        });


        html.find('.edit-note-btn').click(async ev => {
            const noteId = String($(ev.currentTarget).data('id'));
            const data = getNotesData();
            if (!data) return;

            const noteIndex = data.notes.findIndex(n => String(n.id || n.time) === noteId);
            if (noteIndex === -1) return;

            const currentText = data.notes[noteIndex].text;

            new Dialog({
                title: "Edit Note",
                content: `<textarea id="edit-note-text" style="width:100%; height: 150px; resize: none; background: rgba(255,255,255,0.9); color: #111; padding: 10px; font-family: inherit;">${currentText}</textarea>`,
                buttons: {
                    save: {
                        icon: '<i class="fas fa-save"></i>',
                        label: "Save Changes",
                        callback: async (dHtml) => {
                            const newText = dHtml.find('#edit-note-text').val().trim();
                            if (newText) {
                                data.notes[noteIndex].text = newText;
                                await data.journal.setFlag("pf2e-npc-architect", `notes_${this.actor.id}`, data.notes);
                                this.render(false);
                            }
                        }
                    },
                    cancel: { icon: '<i class="fas fa-times"></i>', label: "Cancel" }
                },
                default: "save"
            }).render(true);
        });
    }
}