// server.js

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const sql = require('mssql');
require('dotenv').config();
const { GoogleGenerativeAI } = require("@google/generative-ai");


const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const aiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });

const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_HOST, 
    database: process.env.DB_NAME,
    port: parseInt(process.env.DB_PORT || '1433', 10),
    options: {
        encrypt: process.env.DB_ENCRYPT === 'true', 
        trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true' 
    }
};

const app = express();
const port = process.env.PORT || 3000;
app.use(cors());
app.use(express.json());




app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ success: false, message: 'Correo y contraseña son requeridos.' });
    let pool;
    try {
        pool = await sql.connect(dbConfig);
        const result = await pool.request().input('p_correo_param', sql.VarChar, email).execute('login_usuario');
        if (result.recordset.length === 0) return res.status(401).json({ success: false, message: 'Correo o contraseña incorrectos.' });
        const user = result.recordset[0];
        const passwordIsValid = await bcrypt.compare(password, user.contrasena_hash);
        if (!passwordIsValid) return res.status(401).json({ success: false, message: 'Correo o contraseña incorrectos.' });
        res.status(200).json({ success: true, message: 'Login exitoso.', user: { id_usuario: user.id_usuario, nombre_usuario: user.nombre_usuario, genero: user.genero }});
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error interno del servidor.' });
    } finally {
        if (pool) pool.close();
    }
});

app.post('/chat-with-npc', async (req, res) => {
    const { playerMessage, npcPersonality } = req.body;
    if (!playerMessage) return res.status(400).json({ success: false, message: 'El mensaje del jugador no puede estar vacío.' });
    const prompt = `Eres un PNJ en un videojuego. Tu personalidad es: "${npcPersonality || 'amable'}". Un jugador te dice: "${playerMessage}". Responde brevemente y en personaje pero en ingles.`;
    try {
        const result = await aiModel.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        res.status(200).json({ success: true, npcResponse: text });
    } catch (error) {
        res.status(500).json({ success: false, message: 'El PNJ no puede responder ahora.' });
    }
});

app.post('/update-score', async (req, res) => {
    const { userId, finalScore } = req.body;
    if (userId === undefined || finalScore === undefined) return res.status(400).json({ success: false, message: 'Se requiere userId y finalScore.' });
    let pool;
    try {
        pool = await sql.connect(dbConfig);
        const updateResult = await pool.request().input('p_id_usuario', sql.Int, userId).input('p_puntuacion_total', sql.Int, finalScore).query(`UPDATE leaderboard SET puntuacion_total = @p_puntuacion_total WHERE id_usuario = @p_id_usuario;`);
        if (updateResult.rowsAffected[0] === 0) {
            await pool.request().input('p_id_usuario', sql.Int, userId).input('p_puntuacion_total', sql.Int, finalScore).query(`INSERT INTO leaderboard (id_usuario, puntuacion_total) VALUES (@p_id_usuario, @p_puntuacion_total);`);
            res.status(200).json({ success: true, message: 'Puntuación guardada por primera vez.' });
        } else {
            res.status(200).json({ success: true, message: 'Puntuación actualizada correctamente.' });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error interno del servidor.' });
    } finally {
        if (pool) pool.close();
    }
});


app.post('/update-stats', async (req, res) => {
    const { userId, misiones_completadas, objetos_obtenidos, enemigos_neutralizados, tiempo_total_juego } = req.body;
    if (userId === undefined) return res.status(400).json({ success: false, message: 'Se requiere userId.' });
    let pool;
    try {
        pool = await sql.connect(dbConfig);
        const result = await pool.request().input('p_id_usuario', sql.Int, userId).query(`SELECT 1 FROM estadisticas WHERE id_usuario = @p_id_usuario`);
        if (result.recordset.length > 0) {
            await pool.request()
                .input('p_id_usuario', sql.Int, userId).input('p_misiones', sql.Int, misiones_completadas)
                .input('p_objetos', sql.Int, objetos_obtenidos).input('p_enemigos', sql.Int, enemigos_neutralizados)
                .input('p_tiempo', sql.BigInt, tiempo_total_juego)
                .query(`UPDATE estadisticas SET misiones_completadas = @p_misiones, objetos_obtenidos = @p_objetos, enemigos_neutralizados = @p_enemigos, tiempo_total_juego = @p_tiempo WHERE id_usuario = @p_id_usuario;`);
        } else {
            await pool.request()
                .input('p_id_usuario', sql.Int, userId).input('p_misiones', sql.Int, misiones_completadas)
                .input('p_objetos', sql.Int, objetos_obtenidos).input('p_enemigos', sql.Int, enemigos_neutralizados)
                .input('p_tiempo', sql.BigInt, tiempo_total_juego)
                .query(`INSERT INTO estadisticas (id_usuario, misiones_completadas, objetos_obtenidos, enemigos_neutralizados, tiempo_total_juego) VALUES (@p_id_usuario, @p_misiones, @p_objetos, @p_enemigos, @p_tiempo);`);
        }
        res.status(200).json({ success: true, message: 'Estadísticas finales guardadas correctamente.' });
    } catch (err) {
        console.error('Error en /update-stats:', err.message);
        res.status(500).json({ success: false, message: 'Error interno del servidor.' });
    } finally {
        if (pool) pool.close();
    }
});

app.listen(port, () => {
    console.log(`Servidor API escuchando en http://localhost:${port}`);
});