require('dotenv').config();
const { GoogleGenerativeAI } = require("@google/generative-ai");
const path = require('path');
const fs = require('fs');

// Configurar la API de Google AI
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// Función para procesar la imagen con Gemini 1.5
const chat = async (prompt, text) =>{
  const formatPrompt = `Sos un asistente virtual. Al final te voy a dar un input que envio el usuario.
  \n\n${prompt}\n\nEl input del usuario es el siguiente: ${text}`;


    const result = await model.generateContent(formatPrompt);
    const response = result.response;
    const answ = response.text();
    return answ;
  };

  const image2text = async (prompt, imagePath) => {
    const resolvedPath = path.resolve(imagePath);
    const imageBuffer = fs.readFileSync (resolvedPath);

    const image = {
      inlineData: {
        data: imageBuffer.toString('base64'),
        mimeType: "image/JPEG",
      }
    }
  
  
  const result = await model.generateContent([prompt, image]);
  return result.response.text();
};
  module.exports = { image2text };