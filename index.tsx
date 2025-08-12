/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import {GoogleGenAI, Type} from '@google/genai';
import * as pdfjsLib from 'pdfjs-dist';

// Set worker path for pdf.js, sourced from the import map in index.html.
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://esm.sh/pdfjs-dist@4.4.168/build/pdf.worker.mjs';

// --- TYPE DEFINITIONS ---
interface Flashcard {
  term: string;
  definition: string;
}

interface QuizQuestion {
  questionText: string;
  questionType: 'multiple-choice' | 'true-false';
  options: string[];
  answer: string;
  explanation: string;
}

// --- DOM ELEMENT SELECTION ---
const generateButton = document.getElementById(
  'generateButton',
) as HTMLButtonElement;
const errorMessage = document.getElementById('errorMessage') as HTMLDivElement;

// Tab and Panel Elements
const quizTab = document.getElementById('quizTab') as HTMLButtonElement;
const flashcardsTab = document.getElementById(
  'flashcardsTab',
) as HTMLButtonElement;
const quizPanel = document.getElementById('quizPanel') as HTMLDivElement;
const flashcardsPanel = document.getElementById(
  'flashcardsPanel',
) as HTMLDivElement;

// PDF-related Elements
const pdfUploadSection = document.getElementById(
  'pdfUploadSection',
) as HTMLElement;
const pdfUpload = document.getElementById('pdfUpload') as HTMLInputElement;
const pdfUploadLabel = document.getElementById(
  'pdfUploadLabel',
) as HTMLLabelElement;
const pdfFileList = document.getElementById('pdfFileList') as HTMLDivElement;

// Output Containers
const flashcardsContainer = document.getElementById(
  'flashcardsContainer',
) as HTMLDivElement;
const quizContainer = document.getElementById('quizContainer') as HTMLDivElement;
const quizActions = document.getElementById('quizActions') as HTMLDivElement;
const checkAnswersButton = document.getElementById(
  'checkAnswersButton',
) as HTMLButtonElement;
const quizResult = document.getElementById('quizResult') as HTMLDivElement;

// --- STATE MANAGEMENT ---
let uploadedFiles: File[] = [];
let activeTab: 'quiz' | 'flashcards' = 'quiz';
let quizData: QuizQuestion[] | null = null;
let isGenerating = false;

// --- API INITIALIZATION ---
const ai = new GoogleGenAI({apiKey: process.env.API_KEY});

// --- UI LOGIC ---

/**
 * Manages the UI state, enabling/disabling buttons and showing messages.
 * @param loading - Whether the app is in a loading state.
 * @param message - An optional message to display in the error/status area.
 */
function setUIState(loading: boolean, message = '') {
  isGenerating = loading;
  generateButton.disabled = loading || uploadedFiles.length === 0;
  errorMessage.textContent = message;
  if (loading) {
    // Clear previous results when starting a new generation
    quizContainer.innerHTML = '';
    flashcardsContainer.innerHTML = '';
    quizActions.style.display = 'none';
    quizResult.innerHTML = '';
  }
}

/**
 * Switches between the Quiz and Flashcards tabs.
 * @param tabToActivate - The tab to activate.
 */
function switchTab(tabToActivate: 'quiz' | 'flashcards') {
  activeTab = tabToActivate;

  const isQuiz = activeTab === 'quiz';
  quizTab.classList.toggle('active', isQuiz);
  quizTab.setAttribute('aria-selected', String(isQuiz));
  quizPanel.classList.toggle('active', isQuiz);

  flashcardsTab.classList.toggle('active', !isQuiz);
  flashcardsTab.setAttribute('aria-selected', String(!isQuiz));
  flashcardsPanel.classList.toggle('active', !isQuiz);

  generateButton.textContent = isQuiz ? 'Generate Quiz' : 'Generate Flashcards';
}

/**
 * Renders the list of currently uploaded PDF files.
 */
function renderFileList() {
  pdfFileList.innerHTML = '';
  pdfUploadLabel.textContent =
    uploadedFiles.length > 0
      ? 'Add More PDFs'
      : 'Click to upload or drag & drop PDFs here';

  uploadedFiles.forEach((file) => {
    const fileItem = document.createElement('div');
    fileItem.className = 'file-list-item';
    const fileNameSpan = document.createElement('span');
    fileNameSpan.textContent = file.name;
    fileNameSpan.title = file.name;
    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-file-btn';
    removeBtn.innerHTML = '&times;';
    removeBtn.setAttribute('aria-label', `Remove ${file.name}`);
    removeBtn.dataset.filename = file.name;
    fileItem.append(fileNameSpan, removeBtn);
    pdfFileList.appendChild(fileItem);
  });
  generateButton.disabled = isGenerating || uploadedFiles.length === 0;
}

/**
 * Handles file selection from input or drag-and-drop.
 * @param files - A FileList object.
 */
function handleFiles(files: FileList) {
  const newFiles = Array.from(files).filter(
    (file) =>
      file.type === 'application/pdf' &&
      !uploadedFiles.some((f) => f.name === file.name),
  );
  if (newFiles.length > 0) {
    uploadedFiles.push(...newFiles);
    renderFileList();
  }
}

/**
 * Removes a file from the uploaded list.
 * @param fileName - The name of the file to remove.
 */
function removeFile(fileName: string) {
  uploadedFiles = uploadedFiles.filter((f) => f.name !== fileName);
  renderFileList();
}

// --- PDF PROCESSING ---

/**
 * Extracts text content from a given PDF file.
 * @param file - The PDF file to process.
 * @returns A promise that resolves to the extracted text.
 */
async function extractTextFromPdf(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({data: arrayBuffer}).promise;
  let fullText = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((item: any) => item.str).join(' ');
    fullText += pageText + '\n\n';
  }
  return fullText;
}

// --- QUIZ GENERATION AND DISPLAY ---

const quizSchema = {
  type: Type.OBJECT,
  properties: {
    questions: {
      type: Type.ARRAY,
      description: 'An array of quiz question objects.',
      items: {
        type: Type.OBJECT,
        properties: {
          questionText: {type: Type.STRING, description: 'The question.'},
          questionType: {
            type: Type.STRING,
            description: "Type: 'multiple-choice' or 'true-false'.",
          },
          options: {
            type: Type.ARRAY,
            items: {type: Type.STRING},
            description: "Possible answers. For 'true-false', use ['True', 'False'].",
          },
          answer: {
            type: Type.STRING,
            description: 'The correct answer, must match an option.',
          },
          explanation: {
            type: Type.STRING,
            description: 'Brief explanation for the correct answer.',
          },
        },
        required: [
          'questionText',
          'questionType',
          'options',
          'answer',
          'explanation',
        ],
      },
    },
  },
  required: ['questions'],
};

async function generateQuiz(context: string) {
  const prompt = `Based on the following document text, generate a quiz with 8-10 questions. The quiz should contain a mix of multiple-choice and true/false questions that test key concepts. Include 2-3 tricky questions that require careful reading or inference from the text. The 'answer' field must exactly match one of the strings from the 'options' array. For 'true-false' questions, the 'options' array must be ["True", "False"]. Format the output as a JSON object that strictly adheres to the provided schema.\n\nText: """${context}"""`;

  const result = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {responseMimeType: 'application/json', responseSchema: quizSchema},
  });

  const jsonString = result.text.trim();
  const data = JSON.parse(jsonString);
  quizData = data.questions as QuizQuestion[];

  if (!quizData || quizData.length === 0) {
    throw new Error('No quiz questions could be generated from the document.');
  }
  displayQuiz();
}

function displayQuiz() {
  if (!quizData) return;
  quizContainer.innerHTML = '';
  quizData.forEach((question, index) => {
    const questionEl = document.createElement('div');
    questionEl.className = 'quiz-question';
    questionEl.innerHTML = `<p class="question-text">${index + 1}. ${question.questionText}</p>`;
    const optionsContainer = document.createElement('div');
    optionsContainer.className = 'options-container';
    question.options.forEach((option) => {
      const optionId = `q${index}-opt${option.replace(/\s+/g, '')}`;
      const optionLabel = document.createElement('label');
      optionLabel.className = 'option-label';
      optionLabel.htmlFor = optionId;
      optionLabel.innerHTML = `<input type="radio" id="${optionId}" name="q${index}" value="${option}"> ${option}`;
      optionsContainer.appendChild(optionLabel);
    });
    questionEl.appendChild(optionsContainer);
    const explanationEl = document.createElement('div');
    explanationEl.className = 'explanation';
    explanationEl.style.display = 'none';
    explanationEl.textContent = question.explanation;
    questionEl.appendChild(explanationEl);
    quizContainer.appendChild(questionEl);
  });
  quizActions.style.display = 'block';
  checkAnswersButton.disabled = false;
  quizResult.innerHTML = '';
}

function checkAnswers() {
  if (!quizData) return;
  let score = 0;
  quizData.forEach((question, index) => {
    const selected = document.querySelector<HTMLInputElement>(`input[name="q${index}"]:checked`);
    const options = document.querySelectorAll<HTMLInputElement>(`input[name="q${index}"]`);
    options.forEach(opt => (opt.disabled = true));

    if (selected) {
      const parentLabel = selected.parentElement as HTMLLabelElement;
      if (selected.value === question.answer) {
        score++;
        parentLabel.classList.add('correct');
      } else {
        parentLabel.classList.add('incorrect');
        // Also show the correct one
        const correctEl = document.querySelector<HTMLInputElement>(`input[name="q${index}"][value="${CSS.escape(question.answer)}"]`);
        if (correctEl) (correctEl.parentElement as HTMLLabelElement).classList.add('correct');
      }
    }
    const explanation = quizContainer.children[index].querySelector('.explanation') as HTMLDivElement;
    if (explanation) explanation.style.display = 'block';
  });

  quizResult.textContent = `You scored ${score} out of ${quizData.length}!`;
  checkAnswersButton.disabled = true;
}


// --- FLASHCARD GENERATION AND DISPLAY ---

async function generateFlashcards(context: string) {
  const prompt = `Based on the following text, generate a list of flashcards. Each flashcard must have a term and a concise definition. Format the output as a list of "Term: Definition" pairs, with each pair on a new line.\n\nText: """${context}"""`;

  const result = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
  });
  const responseText = result.text.trim();
  const flashcards: Flashcard[] = responseText.split('\n').map((line) => {
      const parts = line.split(':');
      if (parts.length >= 2) {
        const term = parts[0].trim();
        const definition = parts.slice(1).join(':').trim();
        if (term && definition) return {term, definition};
      }
      return null;
    }).filter((card): card is Flashcard => card !== null);

  if (flashcards.length === 0) {
    throw new Error('No valid flashcards could be generated.');
  }
  displayFlashcards(flashcards);
}


function displayFlashcards(flashcards: Flashcard[]) {
  flashcardsContainer.innerHTML = '';
  flashcards.forEach((flashcard) => {
    const cardDiv = document.createElement('div');
    cardDiv.classList.add('flashcard');
    cardDiv.setAttribute('role', 'button');
    cardDiv.tabIndex = 0;
    cardDiv.innerHTML = `
      <div class="flashcard-inner">
        <div class="flashcard-front"><div class="term">${flashcard.term}</div></div>
        <div class="flashcard-back"><div class="definition">${flashcard.definition}</div></div>
      </div>`;
    cardDiv.addEventListener('click', () => cardDiv.classList.toggle('flipped'));
    cardDiv.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') cardDiv.classList.toggle('flipped');
    });
    flashcardsContainer.appendChild(cardDiv);
  });
}

// --- MAIN GENERATION ORCHESTRATOR ---
async function handleGenerateClick() {
  if (uploadedFiles.length === 0) {
    setUIState(false, 'Please upload at least one PDF file to begin.');
    return;
  }
  setUIState(true, 'Reading PDF content...');

  try {
    const allText = await Promise.all(uploadedFiles.map(extractTextFromPdf));
    const combinedText = allText.join('\n').trim();

    if (!combinedText) {
      throw new Error('Could not extract text from the provided PDFs.');
    }

    setUIState(true, `Generating ${activeTab}... this may take a moment.`);

    if (activeTab === 'quiz') {
      await generateQuiz(combinedText);
    } else {
      await generateFlashcards(combinedText);
    }
    setUIState(false); // Success
  } catch (error) {
    console.error('Generation Error:', error);
    const message = (error as Error)?.message || 'An unknown error occurred.';
    setUIState(false, `Error: ${message}`);
  }
}


// --- EVENT LISTENERS ---
quizTab.addEventListener('click', () => switchTab('quiz'));
flashcardsTab.addEventListener('click', () => switchTab('flashcards'));

pdfUpload.addEventListener('change', () => {
  if (pdfUpload.files) handleFiles(pdfUpload.files);
});

pdfFileList.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (target.classList.contains('remove-file-btn')) {
    const fileName = target.dataset.filename;
    if (fileName) removeFile(fileName);
  }
});

pdfUploadSection.addEventListener('dragover', (e) => {
  e.preventDefault();
  pdfUploadSection.classList.add('dragover');
});

pdfUploadSection.addEventListener('dragleave', (e) => {
  e.preventDefault();
  pdfUploadSection.classList.remove('dragover');
});

pdfUploadSection.addEventListener('drop', (e) => {
  e.preventDefault();
  pdfUploadSection.classList.remove('dragover');
  if (e.dataTransfer?.files) handleFiles(e.dataTransfer.files);
});

generateButton.addEventListener('click', handleGenerateClick);
checkAnswersButton.addEventListener('click', checkAnswers);

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
  switchTab('quiz'); // Start on the quiz tab
  renderFileList(); // Initial call to set button state
});
