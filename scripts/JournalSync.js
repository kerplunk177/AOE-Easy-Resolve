export async function syncDossier(actor) {
    const journalName = actor.name;
    const folderName = "NPC Dossiers";


    let folder = game.folders.find(f => f.name === folderName && f.type === "JournalEntry");
    if (!folder) {
        folder = await Folder.create({ name: folderName, type: "JournalEntry", color: "#FF0000" });
    }


    let journal = game.journal.find(j => j.name === journalName && j.folder?.id === folder.id);
    

    const bio = actor.system.details.biography.value || "No biography.";
    const affiliation = actor.getFlag("pf2e-npc-architect", "affiliation") || 0;
    
    const content = `
        <div class="npc-dossier">
            <img src="${actor.img}" width="150" style="float:right; margin-left:10px;">
            <h2>${actor.name}</h2>
            <p><strong>Affiliation:</strong> ${affiliation}/100</p>
            <hr>
            ${bio}
        </div>
    `;

    if (!journal) {
        await JournalEntry.create({
            name: journalName,
            folder: folder.id,
            pages: [{
                name: "Public Profile",
                type: "text",
                text: { content: content }
            }]
        });
        ui.notifications.info(`Created Dossier for ${actor.name}`);
    } else {

        const page = journal.pages.contents[0];
        await page.update({ "text.content": content });
        ui.notifications.info(`Updated Dossier for ${actor.name}`);
    }
}