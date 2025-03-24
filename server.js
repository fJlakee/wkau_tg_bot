const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

// Простой маршрут для проверки работоспособности
app.get('/', (req, res) => {
    res.send('Telegram Schedule Bot is running!');
});

// Запускаем сервер
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
}); 