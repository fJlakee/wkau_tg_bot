const TelegramBot = require('node-telegram-bot-api');
const schedule = require('node-schedule');
const fs = require('fs');
const path = require('path');

// Определяем путь к файлам
const DATA_DIR = process.env.DATA_DIR || '.';
const SCHEDULES_FILE = path.join(DATA_DIR, 'schedules.json');
const GROUP_INDEXES_FILE = path.join(DATA_DIR, 'group_indexes.json');
const USER_DATA_FILE = path.join(DATA_DIR, 'user_data.json');

// Загрузка данных
const groupIndexes = JSON.parse(fs.readFileSync(GROUP_INDEXES_FILE, 'utf8'));
const schedules = JSON.parse(fs.readFileSync(SCHEDULES_FILE, 'utf8'));

// Загрузка данных пользователей
let userData = {};
try {
    userData = JSON.parse(fs.readFileSync(USER_DATA_FILE, 'utf8'));
} catch (error) {
    console.log('No existing user data found, creating new file');
    fs.writeFileSync(USER_DATA_FILE, JSON.stringify({}, null, 2));
}

// Функция для сохранения данных пользователей
function saveUserData() {
    fs.writeFileSync(USER_DATA_FILE, JSON.stringify(userData, null, 2));
}

// Функция для получения данных пользователя
function getUserData(userId) {
    return userData[userId] || null;
}

// Функция для сохранения данных пользователя
function setUserData(userId, data) {
    userData[userId] = data;
    saveUserData();
}

// Замените на ваш токен
const token = '8159232021:AAEFQCjcEEE5ZkjGowMGMIJ3iuNay28WMHo';
const bot = new TelegramBot(token, { polling: true });

// Состояния пользователей
const userStates = new Map();

// Клавиатуры
const mainKeyboard = {
    reply_markup: {
        keyboard: [
            ['📅 На сегодня', '📅 На завтра'],
            ['📅 На неделю', '⚙️ Изменить группу']
        ],
        resize_keyboard: true
    }
};

const mainInlineKeyboard = {
    reply_markup: {
        inline_keyboard: [
            [{ text: '📅 Расписание на сегодня', callback_data: 'today' }],
            [{ text: '📅 Расписание на завтра', callback_data: 'tomorrow' }],
            [{ text: '📅 Расписание на неделю', callback_data: 'week' }],
            [{ text: '⚙️ Изменить группу', callback_data: 'change_group' }]
        ]
    }
};

// Функции для работы с расписанием
function getScheduleForDay(group, day) {
    if (!schedules[group] || !schedules[group][day]) {
        return null;
    }
    return schedules[group][day];
}

function formatSchedule(lessons) {
    if (!lessons || lessons.length === 0) {
        return 'В этот день занятий нет';
    }
    
    return lessons.map(lesson => {
        // Находим максимальную длину имени преподавателя для выравнивания
        const maxTeacherLength = Math.max(...lesson.teachers.map(teacher => teacher.length));
        
        const teacherClassroomPairs = lesson.teachers.map((teacher, index) => {
            const classroom = lesson.classrooms[index] || 'Аудитория не указана';
            // Добавляем пробелы после имени преподавателя для выравнивания
            const padding = ' '.repeat(maxTeacherLength - teacher.length);
            return `🟢${teacher}${padding}   ${classroom}`;
        }).join('\n');
        
        return `⏰${lesson.time}\n📕${lesson.subject} (${lesson.type})\n${teacherClassroomPairs}\n`;
    }).join('\n');
}

function getNextDaySchedule(group) {
    if (!schedules[group]) {
        return null;
    }
    const days = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница'];
    const today = new Date().getDay();
    const nextDayIndex = today === 0 ? 0 : today;
    const nextDay = days[nextDayIndex];
    return getScheduleForDay(group, nextDay);
}

function getWeekSchedule(group) {
    if (!schedules[group]) {
        return null;
    }
    const days = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница'];
    return days.map(day => {
        const schedule = getScheduleForDay(group, day);
        return `📅 ${day}:\n${formatSchedule(schedule)}\n`;
    }).join('\n');
}

// Функция для создания клавиатуры с кнопкой "Назад"
function createKeyboardWithBack(buttons, backData) {
    const keyboard = buttons.map(button => [button]);
    keyboard.push([{ text: '⬅️ Назад', callback_data: backData }]);
    return keyboard;
}

// Обработчики команд
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    // Проверяем, есть ли сохраненные данные пользователя
    const savedData = getUserData(userId);
    if (savedData) {
        // Если данные есть, восстанавливаем состояние
        userStates.set(chatId, {
            step: 'main',
            group: savedData.group,
            groupId: savedData.groupId
        });
        
        // Отправляем приветственное сообщение с сохраненной группой
        bot.sendMessage(chatId, 
            `С возвращением! Ваша группа: ${savedData.group}\nТеперь вы можете запрашивать расписание.`,
            {
                reply_markup: mainKeyboard.reply_markup
            }
        );
        return;
    }
    
    // Если данных нет, начинаем процесс выбора
    userStates.set(chatId, { step: 'institute' });
    
    const institutes = Object.entries(groupIndexes).map(([id, data]) => ({
        text: data.institute_name,
        callback_data: `institute_${id}`
    }));

    bot.sendMessage(chatId, 'Выберите институт:', {
        reply_markup: {
            inline_keyboard: institutes.map(inst => [inst])
        }
    });
});

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;
    const state = userStates.get(chatId);
    const userId = query.from.id;

    try {
        if (data.startsWith('institute_')) {
            const instituteId = data.split('_')[1];
            if (!groupIndexes[instituteId]) {
                await bot.answerCallbackQuery(query.id, {
                    text: 'Ошибка: институт не найден',
                    show_alert: true
                });
                return;
            }

            const schools = Object.entries(groupIndexes[instituteId].school).map(([id, data]) => ({
                text: data.school_name,
                callback_data: `school_${instituteId}_${id}`
            }));

            userStates.set(chatId, { step: 'school', instituteId });
            
            await bot.editMessageText('Выберите школу:', {
                chat_id: chatId,
                message_id: query.message.message_id,
                reply_markup: {
                    inline_keyboard: createKeyboardWithBack(schools, 'back_to_institute')
                }
            });
        } else if (data.startsWith('school_')) {
            const [, instituteId, schoolId] = data.split('_');
            
            if (!groupIndexes[instituteId] || !groupIndexes[instituteId].school[schoolId]) {
                await bot.answerCallbackQuery(query.id, {
                    text: 'Ошибка: школа не найдена',
                    show_alert: true
                });
                return;
            }

            const groups = Object.entries(groupIndexes[instituteId].school[schoolId].groups).map(([id, name]) => ({
                text: name,
                callback_data: `group_${id}`
            }));

            userStates.set(chatId, { step: 'group', instituteId, schoolId });
            
            await bot.editMessageText('Выберите группу:', {
                chat_id: chatId,
                message_id: query.message.message_id,
                reply_markup: {
                    inline_keyboard: createKeyboardWithBack(groups, `back_to_school_${instituteId}`)
                }
            });
        } else if (data.startsWith('group_')) {
            const groupId = data.split('_')[1];
            const state = userStates.get(chatId);

            if (!state || !state.instituteId || !state.schoolId) {
                await bot.answerCallbackQuery(query.id, {
                    text: 'Ошибка: неверное состояние',
                    show_alert: true
                });
                return;
            }

            const institute = groupIndexes[state.instituteId];
            if (!institute || !institute.school[state.schoolId] || !institute.school[state.schoolId].groups[groupId]) {
                await bot.answerCallbackQuery(query.id, {
                    text: 'Ошибка: группа не найдена',
                    show_alert: true
                });
                return;
            }

            const groupName = institute.school[state.schoolId].groups[groupId];

            // Проверяем наличие расписания для группы
            if (!schedules[groupName]) {
                await bot.answerCallbackQuery(query.id, {
                    text: 'Извините, расписание для этой группы пока недоступно',
                    show_alert: true
                });
                return;
            }

            // Сохраняем данные пользователя
            setUserData(userId, {
                group: groupName,
                groupId: groupId
            });

            userStates.set(chatId, { 
                step: 'main',
                group: groupName,
                groupId
            });

            await bot.editMessageText(
                `Вы выбрали группу: ${groupName}\nТеперь вы можете запрашивать расписание.`,
                {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    reply_markup: mainKeyboard.reply_markup
                }
            );
        } else if (data === 'today') {
            const state = userStates.get(chatId);
            if (!state || !state.group) {
                await bot.answerCallbackQuery(query.id, {
                    text: 'Ошибка: группа не выбрана',
                    show_alert: true
                });
                return;
            }

            const days = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница'];
            const today = new Date().getDay();
            const currentDay = days[today === 0 ? 0 : today];
            
            const schedule = getScheduleForDay(state.group, currentDay);
            if (schedule === null) {
                await bot.editMessageText(
                    `📅 Расписание на сегодня (${currentDay}):\nВ этот день занятий нет`,
                    {
                        chat_id: chatId,
                        message_id: query.message.message_id,
                        reply_markup: mainInlineKeyboard.reply_markup
                    }
                );
                return;
            }

            await bot.editMessageText(
                `📅 Расписание на сегодня (${currentDay}):\n${formatSchedule(schedule)}`,
                {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    reply_markup: mainInlineKeyboard.reply_markup
                }
            );
        } else if (data === 'tomorrow') {
            const state = userStates.get(chatId);
            if (!state || !state.group) {
                await bot.answerCallbackQuery(query.id, {
                    text: 'Ошибка: группа не выбрана',
                    show_alert: true
                });
                return;
            }

            const days = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница'];
            const today = new Date().getDay();
            const nextDayIndex = today === 0 ? 0 : today;
            const nextDay = days[nextDayIndex];
            
            const schedule = getScheduleForDay(state.group, nextDay);
            if (schedule === null) {
                await bot.editMessageText(
                    `📅 Расписание на завтра (${nextDay}):\nВ этот день занятий нет`,
                    {
                        chat_id: chatId,
                        message_id: query.message.message_id,
                        reply_markup: mainInlineKeyboard.reply_markup
                    }
                );
                return;
            }

            await bot.editMessageText(
                `📅 Расписание на завтра (${nextDay}):\n${formatSchedule(schedule)}`,
                {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    reply_markup: mainInlineKeyboard.reply_markup
                }
            );
        } else if (data === 'week') {
            const state = userStates.get(chatId);
            if (!state || !state.group) {
                await bot.answerCallbackQuery(query.id, {
                    text: 'Ошибка: группа не выбрана',
                    show_alert: true
                });
                return;
            }

            const weekSchedule = getWeekSchedule(state.group);
            if (weekSchedule === null) {
                await bot.answerCallbackQuery(query.id, {
                    text: 'Извините, расписание для этой группы пока недоступно',
                    show_alert: true
                });
                return;
            }

            await bot.editMessageText(
                `📅 Расписание на неделю:\n${weekSchedule}`,
                {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    reply_markup: mainInlineKeyboard.reply_markup
                }
            );
        } else if (data === 'change_group') {
            userStates.set(chatId, { step: 'institute' });
            
            const institutes = Object.entries(groupIndexes).map(([id, data]) => ({
                text: data.institute_name,
                callback_data: `institute_${id}`
            }));

            await bot.editMessageText('Выберите институт:', {
                chat_id: chatId,
                message_id: query.message.message_id,
                reply_markup: {
                    inline_keyboard: institutes.map(inst => [inst])
                }
            });
        } else if (data === 'back_to_institute') {
            userStates.set(chatId, { step: 'institute' });
            
            const institutes = Object.entries(groupIndexes).map(([id, data]) => ({
                text: data.institute_name,
                callback_data: `institute_${id}`
            }));

            await bot.editMessageText('Выберите институт:', {
                chat_id: chatId,
                message_id: query.message.message_id,
                reply_markup: {
                    inline_keyboard: institutes.map(inst => [inst])
                }
            });
        } else if (data.startsWith('back_to_school_')) {
            const instituteId = data.split('_')[3];
            
            if (!groupIndexes[instituteId]) {
                await bot.answerCallbackQuery(query.id, {
                    text: 'Ошибка: институт не найден',
                    show_alert: true
                });
                return;
            }

            const schools = Object.entries(groupIndexes[instituteId].school).map(([id, data]) => ({
                text: data.school_name,
                callback_data: `school_${instituteId}_${id}`
            }));

            userStates.set(chatId, { step: 'school', instituteId });
            
            await bot.editMessageText('Выберите школу:', {
                chat_id: chatId,
                message_id: query.message.message_id,
                reply_markup: {
                    inline_keyboard: createKeyboardWithBack(schools, 'back_to_institute')
                }
            });
        }
    } catch (error) {
        console.error('Error in callback query:', error);
        await bot.answerCallbackQuery(query.id, {
            text: 'Произошла ошибка. Пожалуйста, попробуйте снова.',
            show_alert: true
        });
    }
});

// Обработчики команд
bot.onText(/📅 На сегодня/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const savedData = getUserData(userId);
    
    if (!savedData || !savedData.group) {
        bot.sendMessage(chatId, 'Пожалуйста, сначала выберите группу через /start');
        return;
    }

    try {
        const days = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница'];
        const today = new Date().getDay();
        const currentDay = days[today === 0 ? 0 : today];
        
        const schedule = getScheduleForDay(savedData.group, currentDay);
        if (schedule === null) {
            bot.sendMessage(chatId, `📅 Расписание на сегодня (${currentDay}):\nВ этот день занятий нет`);
            return;
        }
        bot.sendMessage(chatId, `📅 Расписание на сегодня (${currentDay}):\n${formatSchedule(schedule)}`);
    } catch (error) {
        console.error('Error in today schedule:', error);
        bot.sendMessage(chatId, 'Произошла ошибка при получении расписания. Пожалуйста, попробуйте позже.');
    }
});

bot.onText(/📅 На завтра/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const savedData = getUserData(userId);
    
    if (!savedData || !savedData.group) {
        bot.sendMessage(chatId, 'Пожалуйста, сначала выберите группу через /start');
        return;
    }

    try {
        const days = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница'];
        const today = new Date().getDay();
        const nextDayIndex = today === 0 ? 0 : today;
        const nextDay = days[nextDayIndex];
        
        const schedule = getScheduleForDay(savedData.group, nextDay);
        if (schedule === null) {
            bot.sendMessage(chatId, `📅 Расписание на завтра (${nextDay}):\nВ этот день занятий нет`);
            return;
        }
        bot.sendMessage(chatId, `📅 Расписание на завтра (${nextDay}):\n${formatSchedule(schedule)}`);
    } catch (error) {
        console.error('Error in tomorrow schedule:', error);
        bot.sendMessage(chatId, 'Произошла ошибка при получении расписания. Пожалуйста, попробуйте позже.');
    }
});

bot.onText(/📅 На неделю/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const savedData = getUserData(userId);
    
    if (!savedData || !savedData.group) {
        bot.sendMessage(chatId, 'Пожалуйста, сначала выберите группу через /start');
        return;
    }

    try {
        const weekSchedule = getWeekSchedule(savedData.group);
        if (weekSchedule === null) {
            bot.sendMessage(chatId, 'Извините, расписание для этой группы пока недоступно');
            return;
        }
        bot.sendMessage(chatId, `📅 Расписание на неделю:\n${weekSchedule}`);
    } catch (error) {
        console.error('Error in week schedule:', error);
        bot.sendMessage(chatId, 'Произошла ошибка при получении расписания. Пожалуйста, попробуйте позже.');
    }
});

// Планировщик для отправки расписания на завтра
schedule.scheduleJob('0 20 * * *', () => {
    userStates.forEach((state, chatId) => {
        if (state.step === 'main' && state.group) {
            const days = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница'];
            const today = new Date().getDay();
            const nextDayIndex = today === 0 ? 0 : today;
            const nextDay = days[nextDayIndex];
            
            const schedule = getScheduleForDay(state.group, nextDay);
            if (schedule === null) {
                bot.sendMessage(chatId, `📅 Напоминание! Расписание на завтра (${nextDay}):\nВ этот день занятий нет`);
            } else {
                bot.sendMessage(chatId, `📅 Напоминание! Расписание на завтра (${nextDay}):\n${formatSchedule(schedule)}`);
            }
        }
    });
});

console.log('Bot is running...'); 