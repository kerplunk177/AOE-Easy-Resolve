export class NpcDossierApp extends Application {
    constructor(options) {
        super(options);
        this.currentSort = "affiliation";
        const savedPos = game.user?.getFlag("pf2e-npc-architect", "dossierBounds");
        if (savedPos) {
            this.position.width = savedPos.width;
            this.position.height = savedPos.height;
            this.position.left = savedPos.left;
            this.position.top = savedPos.top;
        }
    }

    static get defaultOptions() {
        return mergeObject(super.defaultOptions, {
            id: "npc-dossier-hub",
            title: "Campaign Dossier",
            template: "modules/pf2e-npc-architect/templates/dossier-grid.hbs",
            width: 900,
            height: 700,
            classes: ["pf2e-npc-architect"],
            resizable: true
        });
    }

    async close(options) {
        await game.user.setFlag("pf2e-npc-architect", "dossierBounds", {
            width: this.position.width,
            height: this.position.height,
            left: this.position.left,
            top: this.position.top
        });
        return super.close(options);
    }



    getData() {
        const allTracked = game.actors.filter(a => a.getFlag("pf2e-npc-architect", "data")?.tracked);

        const campaigns = ["All", ...new Set(allTracked.map(a => {
            const c = a.getFlag("pf2e-npc-architect", "data")?.campaign;
            return c ? c.trim() : "";
        }).filter(c => c !== ""))].sort();


        const currentCampaign = game.settings.get("pf2e-npc-architect", "activeCampaign") || "All";

        const campaignOptions = campaigns.map(c => {
            return {
                name: c,
                isSelected: c === currentCampaign
            };
        });


        const trackedActors = allTracked.filter(a => {
            if (currentCampaign === "All") return true;
            const c = a.getFlag("pf2e-npc-architect", "data")?.campaign?.trim() || "";
            return c === currentCampaign;
        });

        const isAnimated = game.settings.get("pf2e-npc-architect", "enableAnimations");

        const cards = trackedActors.map(actor => {
            const flags = actor.getFlag("pf2e-npc-architect", "data") || {};
            const isMystified = actor.getFlag("pf2e-npc-architect", "mystified") || false;
            const isLocation = flags.isLocation || false;
            
            let rawAff = flags.affiliation;
            if (Array.isArray(rawAff)) rawAff = rawAff[0];
            rawAff = String(rawAff || "").trim();
            
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


            const rawConnections = flags.connections || [];
            const processedConnections = rawConnections.map(c => {
                if (c.secret && !game.user.isGM) return null;

                const connActor = game.actors.get(c.id);
                if (!connActor) return null;

                const connMystified = connActor.getFlag("pf2e-npc-architect", "mystified") || false;
                const realName = connActor.name;

                let displayImg = connActor.img;
                if (!game.user.isGM && connMystified) {
                    displayImg = "icons/svg/mystery-man.svg";
                }

                return {
                    id: c.id,
                    label: c.label,
                    name: realName,
                    img: displayImg,
                    isSecret: c.secret
                };
            }).filter(c => c !== null);

            return {
                id: actor.id,
                name: actor.name, 
                img: isMystified ? "icons/svg/mystery-man.svg" : actor.img,
                role: flags.role || "Unknown",
                campaignOptions: campaignOptions,
                activeCampaign: currentCampaign,
                isLocation: isLocation, 
                faction: isLocation ? "Locations" : (flags.faction || "Unaligned"), 
                affiliation: affLabel,
                affClass: affClass, 
                blurb: flags.bioPublic ? flags.bioPublic.substring(0, 100) + (flags.bioPublic.length > 100 ? "..." : "") : (isLocation ? "No location details." : "No public details."),
                connections: processedConnections 
            };
        });

        const groups = cards.reduce((acc, card) => {

            let safeFaction = "Unaligned";
            if (typeof card.faction === "string") {
                safeFaction = card.faction.trim();
            } else if (Array.isArray(card.faction)) {
                safeFaction = String(card.faction[0] || "").trim();
            }
            
            if (safeFaction === "") safeFaction = "Unaligned";

            const isHidden = safeFaction.toLowerCase() === "hidden";

            if (isHidden && !game.user.isGM) return acc;

            const key = isHidden ? "Hidden" : safeFaction;
            
            if (!acc[key]) acc[key] = [];
            acc[key].push(card);
            return acc;
        }, {});

        const affWeights = { "Allied": 5, "Friendly": 4, "Neutral": 3, "???": 2, "Dislike": 1, "Enemy": 0 };
        const savedColors = game.settings.get("pf2e-npc-architect", "factionColors") || {};

        let factionList = Object.keys(groups).map(key => {
            groups[key].sort((a, b) => {
                if (this.currentSort === "affiliation") {
                    const weightA = affWeights[a.affiliation] ?? 2;
                    const weightB = affWeights[b.affiliation] ?? 2;
                    if (weightA !== weightB) return weightB - weightA; 
                    return a.name.localeCompare(b.name); 
                } else {
                    return a.name.localeCompare(b.name); 
                }
            });
            return { 
                name: key, 
                color: savedColors[key] || "#e0e0e0", 
                cards: groups[key] 
            };
        });

        let savedOrder = game.settings.get("pf2e-npc-architect", "factionOrder") || [];
        
        factionList.sort((a, b) => {
            if (a.name === "Unaligned") return 1;
            if (b.name === "Unaligned") return -1;
            
            let indexA = savedOrder.indexOf(a.name);
            let indexB = savedOrder.indexOf(b.name);
            
            if (indexA === -1 && indexB === -1) return a.name.localeCompare(b.name);
            if (indexA === -1) return 1;
            if (indexB === -1) return -1;
            
            return indexA - indexB;
        });

        return { 
            factionList: factionList, 
            campaignOptions: campaignOptions,
            activeCampaign: currentCampaign,
            isGM: game.user.isGM,
            currentSort: this.currentSort,
            isAnimated: isAnimated 
        };
    }

    activateListeners(html) {
        super.activateListeners(html);
        


    html.find('.card-image').click(ev => {
        ev.stopPropagation(); 
        const actorId = ev.currentTarget.closest('.dossier-card').dataset.id;
        const actor = game.actors.get(actorId);
        if (actor) {
            import("./NpcPublicSheetApp.js").then(module => {
                new module.NpcPublicSheetApp(actor).render(true);
            });
        }
    });

html.find('.campaign-filter').change(async ev => {
    if (game.user.isGM) {
        await game.settings.set("pf2e-npc-architect", "activeCampaign", ev.target.value);
    }
});
    html.find('.dossier-card').each((i, el) => {
        el.addEventListener('dragstart', ev => {
            const actorId = ev.currentTarget.dataset.id;
            const actor = game.actors.get(actorId);
            if (actor) {
                const dragData = {
                    type: "Actor",
                    uuid: actor.uuid
                };
                ev.dataTransfer.setData("text/plain", JSON.stringify(dragData));
            }
        });
    });
    html.find('.card-content').click(ev => {
        const actorId = ev.currentTarget.closest('.dossier-card').dataset.id;
        const actor = game.actors.get(actorId);
        if (actor) {
            if (actor.testUserPermission(game.user, "LIMITED")) {
                actor.sheet.render(true);
            } else {
                ui.notifications.warn(`You observe ${actor.name}, but do not know them well enough to see their stats.`);
            }
        }
    });


        html.find('.dossier-card').contextmenu(ev => {
            if (!game.user.isGM) return;
            const actorId = ev.currentTarget.dataset.id;
            const actor = game.actors.get(actorId);
            import("./NpcArchitectApp.js").then(module => {
                new module.NpcArchitectApp(actor).render(true);
            });
        });

        html.find('.dossier-search').on('input', (ev) => {
            const term = ev.currentTarget.value.toLowerCase();
            
            html.find('.faction-group').each((i, group) => {
                let hasVisibleCard = false;
                
                $(group).find('.dossier-card').each((j, card) => {
                    const name = $(card).find('.card-title').text().toLowerCase();
                    const blurb = $(card).find('.card-blurb').text().toLowerCase();
                    
                    if (name.includes(term) || blurb.includes(term)) {
                        $(card).removeClass('hidden-by-search');
                        hasVisibleCard = true;
                    } else {
                        $(card).addClass('hidden-by-search');
                    }
                });

                if (hasVisibleCard) {
                    $(group).removeClass('hidden-by-search');
                } else {
                    $(group).addClass('hidden-by-search');
                }
            });
        });

        html.find('.dossier-sort').change((ev) => {
            this.currentSort = ev.currentTarget.value;
            this.render(); 
        });

  
        html.find('.faction-toggle').click((ev) => {
            const header = $(ev.currentTarget);
            const icon = header.find('i');

            const grid = header.closest('.faction-group').find('.dossier-grid');
            
            grid.slideToggle(200, () => {
                if (grid.is(':visible')) {
                    icon.removeClass('fa-chevron-right').addClass('fa-chevron-down');
                } else {
                    icon.removeClass('fa-chevron-down').addClass('fa-chevron-right');
                }
            });
        });


        html.find('.manage-factions-btn').click(async () => {
            const actors = game.actors.filter(a => a.getFlag("pf2e-npc-architect", "data")?.tracked);
            const currentFactions = [...new Set(actors.map(a => {
                const f = a.getFlag("pf2e-npc-architect", "data")?.faction;
                return (f && f.trim() !== "") ? f : "Unaligned";
            }))];
            
            const sortable = currentFactions.filter(f => f !== "Unaligned");
            let savedOrder = game.settings.get("pf2e-npc-architect", "factionOrder") || [];
            let savedColors = game.settings.get("pf2e-npc-architect", "factionColors") || {};
            
            let finalOrder = savedOrder.filter(f => sortable.includes(f)); 
            sortable.forEach(f => { if (!finalOrder.includes(f)) finalOrder.push(f); });
            
            let listHtml = finalOrder.map(f => {
                let fColor = savedColors[f] || "#e0e0e0";
                return `
                <li data-faction="${f}" style="padding:8px; border:1px solid #5a5954; margin-bottom:4px; background:rgba(0,0,0,0.3); color:#e0e0e0; border-radius:3px; display:flex; justify-content:space-between; align-items:center;">
                    <strong style="color:${fColor}; text-shadow: 1px 1px 2px black;">${f}</strong>
                    <div style="display:flex; align-items:center; gap: 10px;">
                        <input type="color" class="faction-color-picker" value="${fColor}" title="Faction Color" style="width: 24px; height: 24px; padding: 0; border: none; cursor: pointer; background: transparent;">
                        <a class="move-up" style="cursor:pointer; padding:5px; color:#aaa;"><i class="fas fa-arrow-up"></i></a>
                        <a class="move-down" style="cursor:pointer; padding:5px; margin-left:5px; color:#aaa;"><i class="fas fa-arrow-down"></i></a>
                    </div>
                </li>
            `}).join("");

            let content = `<p style="color:#e0e0e0;">Reorder factions and pick their display colors.</p>
                           <ul id="faction-sort-list" style="list-style:none; padding:0; margin-bottom:15px;">${listHtml}</ul>`;

            new Dialog({
                title: "Manage Factions",
                content: content,
                buttons: {
                    save: {
                        icon: '<i class="fas fa-save"></i>',
                        label: "Save Changes",
                        callback: async (dHtml) => {
                            let newOrder = [];
                            let newColors = {};
                            dHtml.find('#faction-sort-list li').each((i, el) => {
                                let fac = $(el).data('faction');
                                newOrder.push(fac);
                                newColors[fac] = $(el).find('.faction-color-picker').val();
                            });
                            await game.settings.set("pf2e-npc-architect", "factionOrder", newOrder);
                            await game.settings.set("pf2e-npc-architect", "factionColors", newColors);
                            this.render(); 
                        }
                    }
                },
                render: (dHtml) => {
                    dHtml.find('.move-up').click(ev => {
                        let li = $(ev.currentTarget).closest('li');
                        li.insertBefore(li.prev());
                    });
                    dHtml.find('.move-down').click(ev => {
                        let li = $(ev.currentTarget).closest('li');
                        li.insertAfter(li.next());
                    });
                    dHtml.find('.faction-color-picker').on('input', ev => {
                        $(ev.currentTarget).closest('li').find('strong').css('color', ev.target.value);
                    });
                }
            }, {
                classes: ["dialog", "dossier-dark-dialog"] 
            }).render(true);
        });
    }
}