const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// Определяем путь к файлам
const DATA_DIR = process.env.DATA_DIR || '.';
const GROUP_INDEXES_FILE = path.join(DATA_DIR, 'group_indexes.json');

// Загружаем JSON файл с индексами групп
const institutes = JSON.parse(fs.readFileSync(GROUP_INDEXES_FILE, 'utf-8'));

// Функция для асинхронной задержки
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Создаем лог-файл
function initializeLogFile() {
  const logFile = 'scraper_log.txt';
  fs.writeFileSync(logFile, `=== Scraper Log Started at ${new Date().toISOString()} ===\n\n`, 'utf-8');
  return logFile;
}

// Функция для логирования
function logMessage(logFile, message) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${message}\n`;
  console.log(message);
  fs.appendFileSync(logFile, logEntry, 'utf-8');
}

// Создаем директорию для HTML файлов
function createHtmlsDirectory() {
  try {
    if (!fs.existsSync('htmls')) {
      fs.mkdirSync('htmls');
      return "Created 'htmls' directory";
    } else {
      return "'htmls' directory already exists";
    }
  } catch (e) {
    const errorMsg = `Error creating directory: ${e.message}`;
    throw new Error(errorMsg);
  }
}

// Очистка имени файла от запрещенных символов
function sanitizeFilename(filename) {
  return filename.replace(/[<>:"\/\\|?*]/g, '');
}

// Ожидаем появление элемента на странице
async function waitForElement(page, selector, timeout = 20000) {
  try {
    return await page.waitForSelector(selector, { timeout });
  } catch (e) {
    return null;
  }
}

// Выбираем опцию в выпадающем списке
async function selectOption(page, selectId, value, logFile) {
  try {
    logMessage(logFile, `Attempting to select option ${value} in ${selectId}`);
    const select = await waitForElement(page, `#${selectId}`);
    if (!select) {
      logMessage(logFile, `Element #${selectId} not found!`);
      return false;
    }
    
    // Проверяем, существует ли опция с данным значением
    const optionExists = await page.evaluate((selectId, value) => {
      const select = document.getElementById(selectId);
      for (let i = 0; i < select.options.length; i++) {
        if (select.options[i].value === value) {
          return true;
        }
      }
      return false;
    }, selectId, value);
    
    if (!optionExists) {
      logMessage(logFile, `Option with value ${value} does not exist in ${selectId}`);
      return false;
    }
    
    await page.evaluate((selectId, value) => {
      const select = document.getElementById(selectId);
      select.value = value;
      // Запускаем событие изменения
      const event = new Event('change');
      select.dispatchEvent(event);
    }, selectId, value);
    
    await sleep(1500); // Увеличиваем время ожидания
    logMessage(logFile, `Successfully selected option ${value} in ${selectId}`);
    return true;
  } catch (e) {
    logMessage(logFile, `Error selecting option ${value} in ${selectId}: ${e.message}`);
    return false;
  }
}

// Проверяем, загрузилось ли расписание
async function isScheduleLoaded(page, logFile) {
  try {
    // Проверяем наличие ячеек с временем занятий
    const timeCells = await page.$$('.time-style');
    if (timeCells.length > 0) {
      logMessage(logFile, `Schedule loaded successfully! Found ${timeCells.length} time slots.`);
      
      // Дополнительная проверка наличия занятий
      const lessonCells = await page.$$('.lesson-style');
      logMessage(logFile, `Found ${lessonCells.length} lessons.`);
      
      // Проверим наличие текста занятий
      const subjectText = await page.evaluate(() => {
        const subjects = document.querySelectorAll('.sch_subject');
        return subjects.length > 0 ? subjects[0].textContent : '';
      });
      
      logMessage(logFile, `First subject found: ${subjectText || 'None'}`);
      
      return timeCells.length > 0;
    }
    
    logMessage(logFile, 'Schedule did not load properly. No time slots found.');
    return false;
  } catch (e) {
    logMessage(logFile, `Error checking if schedule loaded: ${e.message}`);
    return false;
  }
}

// Сохраняем HTML расписания
async function saveScheduleHtml(page, groupName, logFile) {
  try {
    logMessage(logFile, `Waiting for schedule page to fully load for ${groupName}...`);
    await sleep(3000);
    
    // Проверяем, загружено ли расписание
    if (!(await isScheduleLoaded(page, logFile))) {
      logMessage(logFile, `Schedule for ${groupName} did not load properly!`);
      // Делаем скриншот для отладки
      await page.screenshot({ path: `error_${sanitizeFilename(groupName)}.png` });
      return false;
    }
    
    // Получаем HTML страницы
    const htmlContent = await page.content();
    
    // Создаем директорию если еще не существует
    if (!fs.existsSync('htmls')) {
      logMessage(logFile, createHtmlsDirectory());
    }
    
    const filename = path.join('htmls', sanitizeFilename(`${groupName}.html`));
    logMessage(logFile, `Saving HTML to file: ${filename}`);
    
    fs.writeFileSync(filename, htmlContent, 'utf-8');
    
    if (fs.existsSync(filename)) {
      const fileSize = fs.statSync(filename).size;
      logMessage(logFile, `Successfully saved HTML for ${groupName} to ${filename} (${fileSize} bytes)`);
      return true;
    } else {
      logMessage(logFile, `File was not created: ${filename}`);
      return false;
    }
  } catch (e) {
    logMessage(logFile, `Error saving HTML for ${groupName}: ${e.message}`);
    logMessage(logFile, `Current working directory: ${process.cwd()}`);
    return false;
  }
}

// Отправляем форму
// Отправляем форму нажатием на кнопку "Выбрать"
async function submitForm(page, logFile) {
    try {
      logMessage(logFile, 'Submitting form by clicking the button...');
      
      const formExists = await page.$('#schedule-form');
      if (!formExists) {
        logMessage(logFile, 'Form #schedule-form not found!');
        return false;
      }
  
      // Проверяем, существует ли кнопка
      const submitButton = await page.$('.schedule-form__btn.submit_btn');
      if (!submitButton) {
        logMessage(logFile, 'Submit button not found!');
        return false;
      }
  
      // Нажимаем на кнопку
      await submitButton.click();
      logMessage(logFile, 'Clicked the submit button.');
  
      // Ждем загрузки расписания (можно увеличить время ожидания)
        await page.waitForSelector('.sch_subject', { timeout: 30000 });
        logMessage(logFile, 'Schedule successfully loaded.');
        return true;

  
      // Проверяем, загрузилось ли расписание
      const scheduleLoaded = await isScheduleLoaded(page, logFile);
      if (!scheduleLoaded) {
        logMessage(logFile, 'Schedule did not load after form submission');
        return false;
      }
      
      logMessage(logFile, 'Form submitted successfully via button click.');
      return true;
    } catch (e) {
      logMessage(logFile, `Error submitting form: ${e.message}`);
      return false;
    }
  }
  

// Основная функция скрейпинга
async function scrapeSchedules() {
  let browser;
  const logFile = initializeLogFile();
  
  try {
    logMessage(logFile, createHtmlsDirectory());
    
    // Логируем версию Node.js и доступную память
    logMessage(logFile, `Node.js version: ${process.version}`);
    logMessage(logFile, `Memory usage: ${JSON.stringify(process.memoryUsage())}`);
    
    // Запускаем браузер
    logMessage(logFile, 'Launching browser...');
    browser = await puppeteer.launch({
      headless: 'new', // Используем новый headless режим
      args: [
        '--disable-gpu',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--window-size=1920,1080'
      ]
    });
    
    const page = await browser.newPage();
    
    // Включаем логирование сетевых запросов
    page.on('response', async (response) => {
      const url = response.url();
      const status = response.status();
      if (status >= 400) {
        logMessage(logFile, `Network error: ${status} on ${url}`);
      }
    });
    
    // Логируем консольные сообщения из браузера
    page.on('console', msg => {
      logMessage(logFile, `Browser console: ${msg.text()}`);
    });
    
    const baseUrl = "https://wkau.edu.kz/ru/raspisanie-zanyatij/";
    logMessage(logFile, `Navigating to base URL: ${baseUrl}`);
    
    // Проверим URL сайта
    try {
      await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      logMessage(logFile, `Current page URL: ${page.url()}`);
      
      // Проверка загрузки страницы расписания
      const pageTitle = await page.title();
      logMessage(logFile, `Page title: ${pageTitle}`);
      
      const isSchedulePage = await page.evaluate(() => {
        return document.getElementById('schedule-form') !== null;
      });
      
      if (!isSchedulePage) {
        logMessage(logFile, 'ERROR: Schedule form not found on the page!');
        await page.screenshot({ path: 'initial_page_error.png' });
      } else {
        logMessage(logFile, 'Schedule form found on the page');
      }
    } catch (e) {
      logMessage(logFile, `Error loading initial page: ${e.message}`);
      await page.screenshot({ path: 'initial_page_error.png' });
    }
    
    // Перебираем все институты
    for (const [instituteId, instituteData] of Object.entries(institutes)) {
      logMessage(logFile, `\nProcessing institute: ${instituteData.institute_name} (ID: ${instituteId})`);
      
      // Перебираем все школы в институте
      for (const [schoolId, schoolData] of Object.entries(instituteData.school)) {
        logMessage(logFile, `\nProcessing school: ${schoolData.school_name} (ID: ${schoolId})`);
        
        // Перебираем все группы в школе
        for (const [groupId, groupName] of Object.entries(schoolData.groups)) {
          logMessage(logFile, `\nProcessing group: ${groupName} (ID: ${groupId})`);
          
          // Переходим на страницу расписания для каждой группы
          logMessage(logFile, `Navigating to base URL: ${baseUrl}`);
          await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 30000 });
          await sleep(3000);
          
          // Проверяем, правильно ли загрузилась начальная страница
          const formExists = await page.evaluate(() => {
            return document.getElementById('schedule-form') !== null;
          });
          
          if (!formExists) {
            logMessage(logFile, 'ERROR: Base page did not load correctly. Schedule form not found!');
            await page.screenshot({ path: `base_page_error_${sanitizeFilename(groupName)}.png` });
            continue;
          }
          
          // Выбираем институт
          if (!(await selectOption(page, "schedule-institute", instituteId.toString(), logFile))) {
            continue;
          }
          
          // Выбираем школу
          if (!(await selectOption(page, "schedule-school", schoolId.toString(), logFile))) {
            continue;
          }
          
          // Выбираем группу
          if (!(await selectOption(page, "schedule-group", groupId.toString(), logFile))) {
            continue;
          }
          
          // Выбираем неделю (11 неделя)
          const weekValue = "11 неделя";
          logMessage(logFile, `Selecting week: ${weekValue}`);
          if (!(await selectOption(page, "schedule-week", weekValue, logFile))) {
            await selectOption(page, "schedule-week", "11", logFile); // Пробуем альтернативное значение
          }
          
          // Проверим текущие выбранные значения перед отправкой формы
          const selectedValues = await page.evaluate(() => {
            return {
              institute: document.getElementById('schedule-institute').value,
              school: document.getElementById('schedule-school').value,
              group: document.getElementById('schedule-group').value,
              week: document.getElementById('schedule-week').value
            };
          });
          
          logMessage(logFile, `Selected values before submit: ${JSON.stringify(selectedValues)}`);
          
          // Отправляем форму
          if (await submitForm(page, logFile)) {
            // Проверяем URL после отправки формы
            logMessage(logFile, `URL after form submit: ${page.url()}`);
            
            // Сохраняем HTML расписания
            if (!(await saveScheduleHtml(page, groupName, logFile))) {
              logMessage(logFile, `Failed to save schedule for ${groupName}`);
            }
          }
          
          await sleep(2000); // Задержка между группами
        }
      }
    }
  } catch (e) {
    logMessage(logFile, `An error occurred: ${e.message}`);
    logMessage(logFile, `Current working directory: ${process.cwd()}`);
  } finally {
    logMessage(logFile, 'Scraping process finished');
    if (browser) {
      logMessage(logFile, 'Closing browser...');
      await browser.close();
    }
  }
}

// Запускаем основную функцию
(async () => {
  console.log(`Starting script in directory: ${process.cwd()}`);
  await scrapeSchedules();
})();

// В конце файла, где сохраняются данные
fs.writeFileSync(GROUP_INDEXES_FILE, JSON.stringify(institutes, null, 2));