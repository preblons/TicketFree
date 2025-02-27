const {
    ActionRowBuilder,
    EmbedBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ButtonBuilder,
    ButtonStyle,
    PermissionsBitField,
    ChannelType,
} = require("discord.js");
const fs = require("fs");
const path = require("path");

const CATEGORY_ID = process.env.CATEGORY_ID || "";
const SUPPORT_ROLE = process.env.SUPPORT_ROLE || "123";
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID || "";
const ticketsFile = path.join(__dirname, 'databases', 'tickets.json');
const embedFilePath = path.join(__dirname, "embed.json");

function loadJSON(filePath) {
    if (fs.existsSync(filePath)) {
        try {
            const data = fs.readFileSync(filePath, "utf8");
            return data ? JSON.parse(data) : [];
        } catch (error) {
            console.error(`Erro ao carregar ${filePath}:`, error);
            return [];
        }
    }
    return [];
}

let tickets = loadJSON(ticketsFile);

function loadEmbedData() {
    return loadJSON(embedFilePath) || null;
}

async function handleTicketCreation(channel) {
    const embedData = loadEmbedData();
    if (!embedData) return channel.send({ content: "❌ Não foi possível carregar os dados da embed." });

    const embed = new EmbedBuilder()
        .setTitle(embedData.title)
        .setDescription(embedData.description)
        .setColor(embedData.color)
        .setImage(embedData.image);

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("open_ticket").setLabel("📩 Abrir Ticket").setStyle(ButtonStyle.Success),
    );

    return channel.send({ embeds: [embed], components: [row] });
}

async function handleInteraction(interaction) {
    if (interaction.isButton()) {
        if (interaction.customId === "open_ticket") {
            const modal = new ModalBuilder()
                .setCustomId("ticket_modal_open")
                .setTitle("📝 Descreva o que precisa:")
                .addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId("ticket_description")
                            .setLabel("Explique o problema:")
                            .setStyle(TextInputStyle.Paragraph)
                            .setRequired(true)
                    )
                );
            return interaction.showModal(modal);
        }
        if (interaction.customId === "claim_ticket") return claimTicket(interaction);
        if (interaction.customId === "close_ticket") return closeTicket(interaction); 
    }

    if (interaction.isModalSubmit() && interaction.customId === "ticket_modal_open") {
        return createTicketChannel(interaction, interaction.fields.getTextInputValue("ticket_description"));
    }

    if (interaction.isModalSubmit()) {
        const userId = interaction.fields.getTextInputValue("user_id");
        const channel = interaction.channel;
        
        try {
            const member = await interaction.guild.members.fetch(userId);
            if (!member) {
                return interaction.reply({ content: "❌ Usuário não encontrado no servidor.", ephemeral: true });
            }
            
            if (interaction.customId === "add_member_modal") {
                await channel.permissionOverwrites.edit(member, {
                    ViewChannel: true,
                    SendMessages: true,
                    ReadMessageHistory: true
                });
                return interaction.reply({ content: `✅ Permissões concedidas a <@${userId}>.`, ephemeral: true });
            }
            
            if (interaction.customId === "remove_member_modal") {
                await channel.permissionOverwrites.delete(member);
                return interaction.reply({ content: `✅ Permissões removidas de <@${userId}>.`, ephemeral: true });
            }
        } catch (error) {
            console.error("Erro ao modificar permissões:", error);
            return interaction.reply({ content: "❌ Ocorreu um erro ao modificar as permissões.", ephemeral: true });
        }
    }
}

async function notifyUser(interaction) {
    const ticket = tickets.find(ticket => String(ticket.ticketId) === String(interaction.channel.id));
    if (!ticket) return interaction.reply({ content: "❌ Este ticket não foi encontrado.", flags: 64 });

    const user = await interaction.client.users.fetch(ticket.creatorId);
    const message = "🔔 Olá, Você foi notificado em seu ticket. Lembre-se de que caso o ticket permaneça inativo por um longo período, ele poderá ser fechado automaticamente. Fique atento!";

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setLabel("Ir para o Ticket")
            .setStyle(ButtonStyle.Link)
            .setURL(`https://discord.com/channels/${interaction.guild.id}/${interaction.channel.id}`)
    );

    try {
        await user.send({ content: message, components: [row] });
        return interaction.reply({ content: "✅ O usuário foi notificado na DM.", flags: 64 });
    } catch (error) {
        return interaction.channel.send({ content: `<@${ticket.creatorId}> ${message}`, components: [row] });
    }
}


async function claimTicket(interaction) {
    if (!interaction.member.roles.cache.has(SUPPORT_ROLE)) {
        return interaction.reply({ content: "❌ Apenas a equipe de suporte pode assumir um ticket.", ephemeral: true });
    }

    const ticket = tickets.find(ticket => String(ticket.ticketId) === String(interaction.channel.id));
    if (!ticket) return interaction.reply({ content: "❌ Este ticket não foi encontrado.", ephemeral: true });

    if (ticket.assigneeId) {
        return interaction.reply({ content: `⚠️ Este ticket já foi assumido por <@${ticket.assigneeId}>.`, ephemeral: true });
    }

    ticket.assigneeId = interaction.user.id;
    fs.writeFileSync(ticketsFile, JSON.stringify(tickets, null, 2));

    const embed = new EmbedBuilder()
        .setTitle("🎟️ Ticket Assumido")
        .setDescription(`O ticket foi assumido por <@${interaction.user.id}>.`)
        .setColor("#ffcc00");

    const updatedRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("close_ticket").setLabel("❌ Fechar Ticket").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("claim_ticket").setLabel("🔰 Assumir Ticket").setStyle(ButtonStyle.Success).setDisabled(true),
    );

    await interaction.message.edit({ components: [updatedRow] });

    await interaction.channel.send({ embeds: [embed] });
    return interaction.reply({ content: "✅ Você assumiu este ticket.", ephemeral: true });
}

async function createTicketChannel(interaction, description) {
    const guild = interaction.guild;
    const user = interaction.user;

    if (!CATEGORY_ID) {
        return interaction.reply({ content: "❌ Categoria de tickets não configurada.", ephemeral: true });
    }

    const channel = await guild.channels.create({
        name: `ticket-${user.username.toLowerCase()}`,
        type: ChannelType.GuildText,
        parent: CATEGORY_ID,
        permissionOverwrites: [
            { id: guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
            { id: user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
            { id: SUPPORT_ROLE, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
        ]
    });

    tickets.push({ ticketId: channel.id, creatorId: user.id, assigneeId: null, description });
    fs.writeFileSync(ticketsFile, JSON.stringify(tickets, null, 2));

    const embed = new EmbedBuilder()
        .setTitle("🎟️ Ticket Aberto")
        .setDescription(`Descrição:\n${description}`)
        .setColor("#00ff99")
        .addFields(
            { name: "Usuário", value: `<@${user.id}>`, inline: true }
        );

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("close_ticket").setLabel("❌ Fechar Ticket").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("claim_ticket").setLabel("🔰 Assumir Ticket").setStyle(ButtonStyle.Success),
    );

    const message = await channel.send({ content: `<@${user.id}> <@&${SUPPORT_ROLE}>`, embeds: [embed], components: [row] });

    await message.pin().catch(console.error);

    return interaction.reply({ content: `✅ Ticket criado: ${channel}`, ephemeral: true });
}

async function closeTicket(interaction) {
    const channel = interaction.channel;
    const ticket = tickets.find(ticket => String(ticket.ticketId) === String(channel.id));
    if (!ticket) return interaction.reply({ content: "❌ Este ticket não foi encontrado.", ephemeral: true });

    const user = await interaction.client.users.fetch(ticket.creatorId);
    const messageLink = `https://discord.com/channels/${interaction.guild.id}/${channel.id}/${ticket.messageId}`;

    const dmMessage = "🔒 Seu ticket foi fechado. Caso precise de mais suporte, abra outro ticket.";

    try {
        await user.send({ content: dmMessage });
    } catch (error) {
        console.error("Erro ao enviar a DM:", error);
        await interaction.channel.send({ content: `<@${ticket.creatorId}> ${dmMessage}` });
    }

    await interaction.reply("🔒 O ticket será fechado em 5 segundos...");
    setTimeout(() => channel.delete(), 5000);

    tickets = tickets.filter(ticket => String(ticket.ticketId) !== String(channel.id));
    fs.writeFileSync(ticketsFile, JSON.stringify(tickets, null, 2));
}

module.exports = { handleTicketCreation, handleInteraction };