require('dotenv').config();
const { join } = require('path');
const { postCompletion } = require("./chatLLM");
const { chat, image2text } = require("./gemini");
const { createBot, createProvider, createFlow, addKeyword, EVENTS, addAnswer } = require('@bot-whatsapp/bot');
const QRPortalWeb = require('@bot-whatsapp/portal');
const BaileysProvider = require('@bot-whatsapp/provider/baileys');
const MockAdapter = require('@bot-whatsapp/database/mock');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const fs = require('fs').promises;
const path = require('path');
const { saveToFile, readFromFile } = require('./fileHandler');

const assetsDir = path.join(__dirname, 'assets');
const dataDir = path.join(__dirname, 'data');
const ticketsDir = path.join(dataDir, 'tickets');
const ordersDir = path.join(dataDir, 'orders');
const filetempDir = path.join(__dirname, 'filetemp');

// Ensure all necessary directories exist
async function ensureDirectoriesExist() {
  const directories = [assetsDir, dataDir, ticketsDir, ordersDir, filetempDir];
  for (const dir of directories) {
    await fs.mkdir(dir, { recursive: true });
  }
}

// Call this function at the start of your app
ensureDirectoriesExist().catch(console.error);

// Function to check if a number is registered and get the associated name
function getRegisteredName(phoneNumber) {
  const registeredUsers = process.env.REGISTERED_USERS ? process.env.REGISTERED_USERS.split(',') : [];
  for (const user of registeredUsers) {
    const [name, number] = user.split('=');
    if (number === phoneNumber) {
      return name;
    }
  }
  return null;
}

const flowText = addKeyword(EVENTS.WELCOME)
  .addAction(async (ctx, { flowDynamic }) => {
    const userName = getRegisteredName(ctx.from);
    if (!userName) {
      console.log(`Número no registrado intentando acceder: ${ctx.from}`);
      return;
    }

    try {
      const userMessage = ctx.body.toLowerCase();
      let responsee;

      if (userMessage.startsWith('guardar:')) {
        const [command, filename, ...contentArray] = userMessage.split(':');
        const content = contentArray.join(':').trim();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const formattedContent = `${userName}_${timestamp}_${content}`;
        const success = await saveToFile(`${filename}.txt`, formattedContent);
        responsee = success ? `Información guardada en ${filename}.txt` : "Hubo un error al guardar la información.";
      } else if (userMessage.startsWith('leer:')) {
        const [command, filename] = userMessage.split(':');
        const content = await readFromFile(`${filename.trim()}.txt`);
        responsee = content ? content : `No se pudo leer el archivo ${filename}.txt`;
      } else {
        const messages = [
          { "role": "system", "content": "Eres un asistente para una tienda de abarrotes, que ayudarás en cualquier cosa que te ordenen" },
          { "role": "user", "content": ctx.body }
        ];
        responsee = await postCompletion(messages);
      }

      await flowDynamic(responsee);
    } catch (error) {
      console.error("Error al procesar el mensaje de texto:", error);
      await flowDynamic("Lo siento, hubo un error al procesar tu mensaje. Por favor, intenta de nuevo.");
    }
  });

  const flowMedia = addKeyword(EVENTS.MEDIA)
  .addAction(async (ctx, { flowDynamic, state, gotoFlow }) => {
    const userName = getRegisteredName(ctx.from);
    if (!userName) {
      console.log(`Número no registrado intentando acceder: ${ctx.from}`);
      return;
    }

    console.log("Recibí un mensaje con posible contenido multimedia");
    try {
      let mediaMessage = null;
      let mediaType = '';

 // Check for media in the message
 if (ctx.message.imageMessage) {
  mediaMessage = ctx.message.imageMessage;
  mediaType = 'image';
} else if (ctx.message.videoMessage) {
  mediaMessage = ctx.message.videoMessage;
  mediaType = 'video';
} else if (ctx.message.audioMessage) {
  mediaMessage = ctx.message.audioMessage;
  mediaType = 'audio';
} else if (ctx.message.documentMessage) {
  mediaMessage = ctx.message.documentMessage;
  mediaType = 'document';
} else if (ctx.message.stickerMessage) {
  mediaMessage = ctx.message.stickerMessage;
  mediaType = 'sticker';
}

// If no media found in the main message, check quoted message
if (!mediaMessage && ctx.message.extendedTextMessage?.contextInfo?.quotedMessage) {
  const quotedMessage = ctx.message.extendedTextMessage.contextInfo.quotedMessage;
  if (quotedMessage.imageMessage) {
    mediaMessage = quotedMessage.imageMessage;
    mediaType = 'image';
  } else if (quotedMessage.videoMessage) {
    mediaMessage = quotedMessage.videoMessage;
    mediaType = 'video';
  } else if (quotedMessage.audioMessage) {
    mediaMessage = quotedMessage.audioMessage;
    mediaType = 'audio';
  } else if (quotedMessage.documentMessage) {
    mediaMessage = quotedMessage.documentMessage;
    mediaType = 'document';
  } else if (quotedMessage.stickerMessage) {
    mediaMessage = quotedMessage.stickerMessage;
    mediaType = 'sticker';
  }
}

if (!mediaMessage) {
  await flowDynamic("No se encontró un mensaje multimedia válido. Por favor, envía una imagen, video, audio, documento o sticker.");
  return;
}

// Download the media message
const buffer = await downloadMediaMessage(
  { key: ctx.key, message: { [mediaType + 'Message']: mediaMessage } },
  'buffer',
  {}
);
      // Determine file extension based on MIME type
      const mimeType = mediaMessage.mimetype;
      const extension = mimeType.split('/')[1];

      // Save the media file temporarily
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const tempFileName = `temp_${userName}_${timestamp}.${extension}`;
      const tempFilePath = path.join(filetempDir, tempFileName);
      await fs.writeFile(tempFilePath, buffer);

      // Save the temporary file path in the state
      await state.update({ tempFilePath, mediaType });

      if (mediaType === 'image') {
        await flowDynamic("Imagen recibida. Por favor, responde con la 'ticket' o 'pedido' para clasificarla.");
        return gotoFlow(flowClassifyImaget, flowClassifyImagep);
      } else {
        const fileName = `${mediaType}_${userName}_${timestamp}.${extension}`;
        const savePath = path.join(filetempDir, fileName);
        await fs.rename(tempFilePath, savePath);
        await flowDynamic(`Archivo multimedia de tipo ${mediaType} guardado como ${fileName}`);
      }
    } catch (error) {
      console.error("Error al procesar el mensaje multimedia:", error);
      await flowDynamic("Lo siento, hubo un error al procesar el archivo multimedia. Por favor, intenta enviarlo de nuevo.");
    }
  });

const flowClassifyImaget = addKeyword(["Ticket", "Ticket"])
  .addAction({capture: true}, async (ctx, { flowDynamic, state, gotoFlow }) => {
    const currentState = state.getMyState();
    if (!currentState || !currentState.tempFilePath) {
      await flowDynamic("Lo siento, no hay una imagen pendiente para clasificar. Por favor, envía una imagen primero.");
      return;
    }
    
    const imageType = ctx.body.toLowerCase();
    await state.update({ ...currentState, imageType });

    await flowDynamic(`Imagen clasificada como ${imageType}.`);
    return gotoFlow(flowSaveClassifiedImaget);
  });

  const flowClassifyImagep = addKeyword(["Pedido", "Pedido"])
  .addAction({capture: true}, async (ctx, { flowDynamic, state, gotoFlow }) => {
    const currentState = state.getMyState();
    if (!currentState || !currentState.tempFilePath) {
      await flowDynamic("Lo siento, no hay una imagen pendiente para clasificar. Por favor, envía una imagen primero.");
      return;
    }
    
    const imageType = ctx.body.toLowerCase();
    await state.update({ ...currentState, imageType });

    await flowDynamic(`Imagen clasificada como ${imageType}.`);
    return gotoFlow(flowSaveClassifiedImagep);
  });

  const flowSaveClassifiedImaget = addKeyword(EVENTS.ACTION)  
  .addAction(async (ctx, { flowDynamic, state }) => {    
    
    const currentState = state.getMyState();    
    const { tempFilePath, imageType } = currentState;    
    const userName = getRegisteredName(ctx.from);    
    const extension = path.extname(tempFilePath);    
    const timestamp = new Date().toLocaleDateString().replace(/[/]/g, '-');   

    if (!currentState || !currentState.tempFilePath || !currentState.imageType) {      
      await flowDynamic("Lo siento, hubo un error en el proceso. Por favor, intenta enviar la imagen de nuevo.");            
      return;    
    } else if ( currentState.imageType === 'ticket') {      
      const fileNamet = `${imageType}_${userName}_${timestamp}${extension}`;      
      const savePatht = path.join(ticketsDir, fileNamet);            
      await fs.rename(tempFilePath, savePatht);        
      await flowDynamic(`${imageType.charAt(0).toUpperCase() + imageType.slice(1)} guardado como ${fileNamet}`);        
      await state.clear();        
      return;    
    }
    })
  const flowSaveClassifiedImagep = addKeyword(EVENTS.ACTION).addAnswer("Escribe el proveedor")  
  .addAction({ capture: true }, async (ctx, { flowDynamic, state }) => {    
    const provider = ctx.body.toLowerCase();
    const currentState = state.getMyState();    
    const { tempFilePath, imageType } = currentState;    
    const userName = getRegisteredName(ctx.from);    
    const extension = path.extname(tempFilePath);    
    const timestamp = new Date().toLocaleDateString().replace(/[/]/g, '-');   

    if (!currentState || !currentState.tempFilePath || !currentState.imageType) {      
      await flowDynamic("Lo siento, hubo un error en el proceso. Por favor, intenta enviar la imagen de nuevo.");            
      return;    
    } else if (currentState.imageType === 'pedido') {      
        const fileNamep = `${imageType}_${userName}_${timestamp}_${provider}${extension}`;                
        const savePathp = path.join(ordersDir, fileNamep);                
        await fs.rename(tempFilePath, savePathp);                
        await flowDynamic(`${imageType.charAt(0).toUpperCase() + imageType.slice(1)} guardado como ${fileNamep}`);                
        await state.clear();            
        return;  
    }  
  })




    
   //   switch (imageType){
     //   case "ticket"():
      //const fileNamet = `${imageType}_${userName}_${timestamp}${extension}`;
     // const savePatht = path.join(ticketsDir, fileNamet);
      
    //  await fs.rename(tempFilePath, savePatht);
     //   await flowDynamic(`${imageType.charAt(0).toUpperCase() + imageType.slice(1)} guardado como ${fileNamet}`);
     //   await state.clear();
 // return;
       // case "pedido"()
       //   .addAnswer ("Escribe el Proveedor", {capture: true}, async (ctx, ctxFn) => {
       //   const provider = ctx.body;
       //   const fileNamep = `${imageType}_${userName}_${timestamp}_${provider}${extension}`;
       //   const savePathp = path.join(ordersDir, fileNamep);
       //   await fs.rename(tempFilePath, savePathp);
       // await flowDynamic(`${imageType.charAt(0).toUpperCase() + imageType.slice(1)} guardado como ${fileNamep}`);
       // await state.clear();
     // return;
  
      // Procesar la imagen si es una imagen
      //if (mediaType === 'image') {
      //  const imageText = await image2text("Leer el ticket o nota y sacar toda la información", savePath);
      //  mediaInfo += `\nContenido de la imagen: ${imageText}`;
      //}

      // Preparar el mensaje para postCompletion
      //const messages = [
      //  { "role": "system", "content": "Eres un asistente para una tienda de abarrotes cual los empleados te usaran para guardar informacion o solicitarla, que ayudaras en cualquier cosa que te ordenen" },
      //  { "role": "user", "content": `Se ha recibido un mensaje multimedia de ${userName}. ${mediaInfo}` }
     // ];

      // Procesar el mensaje con postCompletion
      //const response = await postCompletion(messages);

      // Enviar la respuesta al usuario
     // await flowDynamic(response);

    //} catch (error) {
    //  console.error("Error al procesar el mensaje multimedia:", error);
    //  await flowDynamic("Lo siento, hubo un error al procesar el archivo multimedia. Por favor, intenta enviarlo de nuevo.");
   // }
const flowViewImages = addKeyword('ver imagenes')
  .addAction({capture : true }, async (ctx, { flowDynamic }) => {
    const userName = getRegisteredName(ctx.from);
    if (!userName) {
      console.log(`Número no registrado intentando acceder: ${ctx.from}`);
      return;
    }

    const [_, folder] = ctx.body.split(' ');
    let targetDir;

    switch (folder) {
      case 'tickets':
        targetDir = ticketsDir;
        break;
      case 'pedidos':
        targetDir = ordersDir;
        break;
      default:
        targetDir = assetsDir;
    }

    const files = await fs.readdir(targetDir);
    await flowDynamic(`Imágenes en ${folder || 'general'}:\n${files.join('\n')}`);
  });

const flowDeleteImage = addKeyword('eliminar imagen')
  .addAction(async (ctx, { flowDynamic }) => {
    const userName = getRegisteredName(ctx.from);
    if (!userName) {
      console.log(`Número no registrado intentando acceder: ${ctx.from}`);
      return;
    }

    const [_, fileName] = ctx.body.split(' ');
    if (!fileName) {
      await flowDynamic("Por favor, especifica el nombre del archivo a eliminar.");
      return;
    }

    const possiblePaths = [
      path.join(assetsDir, fileName),
      path.join(ticketsDir, fileName),
      path.join(ordersDir, fileName)
    ];

    for (const filePath of possiblePaths) {
      try {
        await fs.unlink(filePath);
        await flowDynamic(`Imagen ${fileName} eliminada.`);
        return;
      } catch (error) {
        if (error.code !== 'ENOENT') console.error(`Error al eliminar ${filePath}:`, error);
      }
    }

    await flowDynamic(`No se encontró la imagen ${fileName}.`);
  });

const flowDeleteAllImages = addKeyword('eliminar todas')
  .addAction(async (ctx, { flowDynamic }) => {
    const userName = getRegisteredName(ctx.from);
    if (!userName) {
      console.log(`Número no registrado intentando acceder: ${ctx.from}`);
      return;
    }

    const [_, folder] = ctx.body.split(' ');
    let targetDir;

    switch (folder) {
      case 'tickets':
        targetDir = ticketsDir;
        break;
      case 'pedidos':
        targetDir = ordersDir;
        break;
      default:
        await flowDynamic("Por favor, especifica 'tickets' o 'pedidos' después de 'eliminar todas'.");
        return;
    }

    const files = await fs.readdir(targetDir);
    for (const file of files) {
      await fs.unlink(path.join(targetDir, file));
    }

    await flowDynamic(`Todas las imágenes en ${folder} han sido eliminadas.`);
  });

  const main = async () => {
    await ensureDirectoriesExist(); // Ensure directories exist before starting the bot
    const adapterDB = new MockAdapter()
    const adapterFlow = createFlow([flowText, flowMedia, flowViewImages, flowDeleteImage, flowDeleteAllImages, flowClassifyImaget, flowClassifyImagep, flowSaveClassifiedImaget, flowSaveClassifiedImagep])
    const adapterProvider = createProvider(BaileysProvider)
  
    createBot({
      flow: adapterFlow,
      provider: adapterProvider,
      database: adapterDB,
    })
  
    QRPortalWeb()
  }
  
  main().catch(console.error);
  
  exports.module = {};
    return null; // This is a placeholder to satisfy the React component requirement
  