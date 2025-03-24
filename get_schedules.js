const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

// Определяем путь к файлам
const DATA_DIR = process.env.DATA_DIR || '.';
const GROUP_INDEXES_FILE = path.join(DATA_DIR, 'group_indexes.json');
const SCHEDULES_FILE = path.join(DATA_DIR, 'schedules.json');

// Функция для чтения HTML файла
function readHtmlFile(filePath) {
    try {
        return fs.readFileSync(filePath, 'utf8');
    } catch (error) {
        console.error(`Error reading file ${filePath}:`, error);
        return null;
    }
}

function formatTime(timeStr) {
    // Remove extra spaces and format as "HH:MM-HH:MM"
    return timeStr.replace(/\s+/g, ' ').trim().replace(' ', '-');
}

function formatTeachers(teacherStr) {
    // Split teachers by dots and commas, clean up and return as array
    return teacherStr
        .split(/[.,]/)
        .map(t => t.trim())
        .filter(t => t.length > 0);
}

// Функция для парсинга информации о занятии
function parseLessonInfo($, lessonElement) {
    const subject = $(lessonElement).find('.sch_subject').text().trim();
    const lessonType = $(lessonElement).find('.sch_type').text().trim();
    
    // Get all teacher-classroom pairs
    const teacherClassroomPairs = [];
    $(lessonElement).find('.sch_teacher').each(function() {
        const teacher = $(this).text().trim();
        // Find the next classroom element after this teacher, handling malformed HTML
        const classroom = $(this).nextAll('span[class="sch_classroom"], span["class="sch_classroom"]').first().text().trim();
        if (teacher) {
            teacherClassroomPairs.push({ teacher, classroom });
        }
    });

    // Only include non-empty lessons
    if (!subject && !lessonType && teacherClassroomPairs.length === 0) {
        return null;
    }

    // Combine all teachers and classrooms
    const teachers = teacherClassroomPairs.map(pair => pair.teacher);
    const classrooms = teacherClassroomPairs.map(pair => pair.classroom).filter(room => room);

    return {
        subject,
        type: lessonType,
        teachers,
        classrooms
    };
}

// Функция для обработки одного HTML файла
function processScheduleFile(filePath) {
    const html = readHtmlFile(filePath);
    if (!html) return null;

    const $ = cheerio.load(html);
    const schedule = {};
    
    // Process each day's schedule
    $('.schedule-table').each((dayIndex, dayTable) => {
        const dayName = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница'][dayIndex];
        const lessons = [];

        $(dayTable).find('tr').each((rowIndex, row) => {
            if (rowIndex === 0) return; // Skip header row

            const timeCell = $(row).find('td').first();
            const time = formatTime(timeCell.text());

            $(row).find('.lesson-style').each((cellIndex, cell) => {
                const lessonInfo = parseLessonInfo($, cell);
                if (lessonInfo) {
                    lessons.push({
                        time,
                        ...lessonInfo
                    });
                }
            });
        });

        if (lessons.length > 0) {
            schedule[dayName] = lessons;
        }
    });
    
    return schedule;
}

// Основная функция для обработки всех файлов
function processAllSchedules() {
    const htmlsDir = path.join(__dirname, 'htmls');
    const schedules = {};

    try {
        if (!fs.existsSync(htmlsDir)) {
            console.error('Directory "htmls" does not exist');
            return;
        }

        const files = fs.readdirSync(htmlsDir);
        for (const file of files) {
            if (file.endsWith('.html')) {
                const filePath = path.join(htmlsDir, file);
                const groupName = path.basename(file, '.html');
                const schedule = processScheduleFile(filePath);
                if (schedule) {
                    schedules[groupName] = schedule;
                    console.log(`Processed schedule for group: ${groupName}`);
                }
            }
        }

        fs.writeFileSync(SCHEDULES_FILE, JSON.stringify(schedules, null, 2));
        console.log('Schedules have been saved to schedules.json');
    } catch (error) {
        console.error('Error processing schedules:', error);
    }
}

// Создаем package.json если его нет
if (!fs.existsSync('package.json')) {
    const packageJson = {
        "name": "schedule-parser",
        "version": "1.0.0",
        "dependencies": {
            "cheerio": "^1.0.0-rc.12"
        }
    };
    fs.writeFileSync('package.json', JSON.stringify(packageJson, null, 2));
}

// Запускаем обработку
processAllSchedules(); 