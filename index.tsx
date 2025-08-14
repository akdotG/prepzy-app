/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { GoogleGenAI, Type } from '@google/genai';
import * as pdfjsLib from 'pdfjs-dist';

// Set up the PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://esm.sh/pdfjs-dist@4.3.136/build/pdf.worker.mjs`;

// --- INTERFACES ---
interface QuizQuestion {
  question: string;
  type: 'mcq' | 'tf';
  options: string[];
  answer: string;
}

interface SubjectiveQuestion {
  question: string;
}

interface Flashcard {
  term: string;
  definition: string;
}

// --- DOM ELEMENTS ---
const loaderOverlay = document.getElementById('loader-overlay') as HTMLDivElement;
const loaderMessage = document.getElementById('loader-message') as HTMLParagraphElement;
const errorMessage = document.getElementById('error-message') as HTMLDivElement;
const backButton = document.getElementById('backButton') as HTMLButtonElement;

// Views
const uploadView = document.getElementById('upload-view') as HTMLDivElement;
const modeSelectView = document.getElementById('mode-select-view') as HTMLDivElement;
const quizView = document.getElementById('quiz-view') as HTMLDivElement;
const subjectiveView = document.getElementById('subjective-view') as HTMLDivElement;
const flashcardView = document.getElementById('flashcard-view') as HTMLDivElement;

// Inputs & Buttons
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const quizModeBtn = document.getElementById('quiz-mode-btn') as HTMLButtonElement;
const subjectiveModeBtn = document.getElementById('subjective-mode-btn') as HTMLButtonElement;
const flashcardModeBtn = document.getElementById('flashcard-mode-btn') as HTMLButtonElement;
const nextQuestionBtn = document.getElementById('next-question-btn') as HTMLButtonElement;
const restartQuizBtn = document.getElementById('restart-quiz-btn') as HTMLButtonElement;
const nextSubjectiveBtn = document.getElementById('next-subjective-btn') as HTMLButtonElement;


// Quiz Elements
const quizProgress = document.getElementById('quiz-progress') as HTMLDivElement;
const quizQuestionContainer = document.getElementById('quiz-question-container') as HTMLDivElement;
const quizQuestionEl = document.getElementById('quiz-question') as HTMLHeadingElement;
const quizOptions = document.getElementById('quiz-options') as HTMLDivElement;
const quizFeedback = document.getElementById('quiz-feedback') as HTMLDivElement;
const quizResults = document.getElementById('quiz-results') as HTMLDivElement;
const quizScoreEl = document.getElementById('quiz-score') as HTMLParagraphElement;

// Subjective Elements
const subjectiveQuestionContainer = document.getElementById('subjective-question-container') as HTMLDivElement;


// --- STATE ---
let documentContent = '';
let quizQuestions: QuizQuestion[] = [];
let subjectiveQuestions: SubjectiveQuestion[] = [];
let currentQuestionIndex = 0;
let score = 0;

// --- API INITIALIZATION ---
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// --- VIEW MANAGEMENT ---
const views = [uploadView, modeSelectView, quizView, subjectiveView, flashcardView];
function showView(viewToShow: HTMLElement) {
  views.forEach(view => {
    if (view === viewToShow) {
        view.style.display = 'flex';
        // Most views are vertical lists of controls, but flashcards wrap horizontally.
        if (view !== flashcardView) {
            view.style.flexDirection = 'column';
            view.style.alignItems = 'center';
        }
    } else {
        view.style.display = 'none';
    }
  });

  if (viewToShow !== uploadView) {
      backButton.style.display = 'block';
  } else {
      backButton.style.display = 'none';
  }
}

function showLoader(message: string) {
  loaderMessage.textContent = message;
  loaderOverlay.style.display = 'flex';
}

function hideLoader() {
  loaderOverlay.style.display = 'none';
}

function displayError(message: string) {
    errorMessage.textContent = message;
}

// --- FILE PROCESSING ---
async function handleFileSelect(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;

  displayError('');
  showLoader('Processing your document...');

  try {
    const fileType = file.type;
    if (fileType === 'application/pdf') {
      documentContent = await extractTextFromPdf(file);
    } else if (fileType.startsWith('image/')) {
      documentContent = await extractTextFromImage(file);
    } else {
      throw new Error('Unsupported file type. Please upload a PDF, JPG, or JPEG.');
    }

    if (!documentContent.trim()) {
      throw new Error('Could not extract any text from the document. It might be empty or unreadable.');
    }
    
    showView(modeSelectView);
  } catch (error) {
    console.error(error);
    displayError((error as Error).message);
    showView(uploadView);
  } finally {
    hideLoader();
    fileInput.value = ''; // Reset file input
  }
}

function extractTextFromImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const base64Data = (e.target?.result as string).split(',')[1];
        const result = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [{
            parts: [
              { text: "Extract all text from this image. Preserve the structure and paragraphs if possible." },
              { inlineData: { mimeType: file.type, data: base64Data } }
            ]
          }]
        });
        resolve(result.text);
      } catch (error) {
        reject(new Error('AI failed to process the image.'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read the image file.'));
    reader.readAsDataURL(file);
  });
}

async function extractTextFromPdf(file: File): Promise<string> {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let textContent = '';
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const text = await page.getTextContent();
        textContent += text.items.map(item => ('str' in item ? item.str : '')).join(' ') + '\n\n';
    }
    return textContent;
}

// --- QUIZ MODE ---
async function startQuiz() {
  showLoader('Creating your quiz...');
  try {
    const result = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `Based on the following document content, generate a quiz with 10 questions. Include a mix of multiple-choice (with 4 options) and true/false questions. Ensure about 20% of the questions are tricky, requiring careful thought. \n\nDOCUMENT:\n${documentContent}`,
        config: {
            responseMimeType: 'application/json',
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    questions: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                question: { type: Type.STRING },
                                type: { type: Type.STRING, enum: ['mcq', 'tf'] },
                                options: { type: Type.ARRAY, items: { type: Type.STRING } },
                                answer: { type: Type.STRING }
                            },
                            required: ['question', 'type', 'answer']
                        }
                    }
                }
            }
        }
    });
    
    const parsedResponse = JSON.parse(result.text);
    quizQuestions = parsedResponse.questions;

    if (!quizQuestions || quizQuestions.length === 0) {
        throw new Error("The AI couldn't generate a quiz from this document. Please try a different one.");
    }

    currentQuestionIndex = 0;
    score = 0;
    showView(quizView);
    quizResults.style.display = 'none';
    quizQuestionContainer.style.display = 'block';
    nextQuestionBtn.style.display = 'none';
    displayQuizQuestion();
  } catch (error) {
    console.error(error);
    displayError('Failed to create the quiz. Please try again.');
    showView(modeSelectView);
  } finally {
    hideLoader();
  }
}

function displayQuizQuestion() {
  quizFeedback.textContent = '';
  quizFeedback.className = 'quiz-feedback';
  nextQuestionBtn.style.display = 'none';

  const question = quizQuestions[currentQuestionIndex];
  quizProgress.textContent = `Question ${currentQuestionIndex + 1} of ${quizQuestions.length}`;
  quizQuestionEl.textContent = question.question;
  quizOptions.innerHTML = '';
  
  const options = question.type === 'tf' ? ['True', 'False'] : question.options;

  options.forEach(option => {
    const button = document.createElement('button');
    button.textContent = option;
    button.classList.add('option-button');
    button.dataset.answer = option;
    button.addEventListener('click', handleQuizAnswer);
    quizOptions.appendChild(button);
  });
}

function handleQuizAnswer(event: Event) {
  const selectedButton = event.target as HTMLButtonElement;
  const selectedAnswer = selectedButton.dataset.answer;
  const correctAnswer = quizQuestions[currentQuestionIndex].answer;

  const isCorrect = selectedAnswer?.toLowerCase() === correctAnswer.toLowerCase();
  
  if (isCorrect) {
    score++;
    selectedButton.classList.add('correct');
    quizFeedback.textContent = "Correct!";
    quizFeedback.classList.add('correct');
  } else {
    selectedButton.classList.add('wrong');
    quizFeedback.textContent = `Wrong! The correct answer is: ${correctAnswer}`;
    quizFeedback.classList.add('wrong');
  }

  Array.from(quizOptions.children).forEach(child => {
      const button = child as HTMLButtonElement;
      if(button.dataset.answer?.toLowerCase() === correctAnswer.toLowerCase()) {
        if(!isCorrect) button.classList.add('correct');
      }
      button.disabled = true;
  });

  nextQuestionBtn.style.display = 'block';
}

function nextQuestion() {
    currentQuestionIndex++;
    if (currentQuestionIndex < quizQuestions.length) {
        displayQuizQuestion();
    } else {
        showQuizResults();
    }
}

function showQuizResults() {
    quizQuestionContainer.style.display = 'none';
    quizResults.style.display = 'block';
    quizProgress.textContent = 'Quiz Complete!';
    nextQuestionBtn.style.display = 'none';
    quizScoreEl.textContent = `Your Score: ${score} out of ${quizQuestions.length}`;
}


// --- SUBJECTIVE MODE ---
async function startSubjective() {
  showLoader('Generating questions...');
  try {
    const result = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `Based on the following document, generate 5 open-ended, subjective questions that require critical thinking to answer.\n\nDOCUMENT:\n${documentContent}`,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    questions: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                question: { type: Type.STRING }
                            },
                             required: ['question']
                        }
                    }
                }
            }
        }
    });

    const parsedResponse = JSON.parse(result.text);
    subjectiveQuestions = parsedResponse.questions;

    if (!subjectiveQuestions || subjectiveQuestions.length === 0) {
        throw new Error("Could not generate questions from this document.");
    }

    currentQuestionIndex = 0;
    subjectiveQuestionContainer.innerHTML = '';
    displaySubjectiveQuestion();
    showView(subjectiveView);

  } catch(error) {
      console.error(error);
      displayError("Failed to generate subjective questions.");
      showView(modeSelectView);
  } finally {
      hideLoader();
  }
}

function displaySubjectiveQuestion() {
    subjectiveQuestionContainer.innerHTML = ''; // Clear previous
    nextSubjectiveBtn.style.display = 'none';

    const question = subjectiveQuestions[currentQuestionIndex];

    const item = document.createElement('div');
    item.className = 'subjective-item';
    item.innerHTML = `
        <h3>Question ${currentQuestionIndex + 1} of ${subjectiveQuestions.length}</h3>
        <p>${question.question}</p>
        <textarea placeholder="Type your answer here..."></textarea>
        <button class="submit-subjective">Analyze My Answer</button>
        <div class="result" style="display: none;"></div>
    `;

    subjectiveQuestionContainer.appendChild(item);

    item.querySelector('.submit-subjective')?.addEventListener('click', async () => {
        const answer = item.querySelector('textarea')?.value;
        const resultDiv = item.querySelector('.result') as HTMLDivElement;
        const submitBtn = item.querySelector('.submit-subjective') as HTMLButtonElement;

        if (!answer?.trim()) {
            resultDiv.textContent = 'Please provide an answer.';
            resultDiv.style.display = 'block';
            return;
        }

        showLoader('Analyzing your answer...');
        submitBtn.disabled = true;

        try {
            const analysisResult = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: `The user was given a document and asked the following question: "${question.question}". Their answer is: "${answer}". Analyze their answer and provide a score out of 5 and brief feedback based on the likely content of the original document.`,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            score: { type: Type.INTEGER },
                            feedback: { type: Type.STRING }
                        },
                        required: ['score', 'feedback']
                    }
                }
            });

            const analysis = JSON.parse(analysisResult.text);
            resultDiv.innerHTML = `
                <p class="score">Score: ${analysis.score}/5</p>
                <p>${analysis.feedback}</p>
            `;
            resultDiv.style.display = 'block';

            if (currentQuestionIndex < subjectiveQuestions.length - 1) {
                nextSubjectiveBtn.style.display = 'block';
            } else {
                nextSubjectiveBtn.textContent = "Finish";
                nextSubjectiveBtn.style.display = 'block';
            }

        } catch(err) {
            resultDiv.textContent = 'Sorry, unable to analyze the answer.';
            resultDiv.style.display = 'block';
        } finally {
            hideLoader();
        }
    });
}

function nextSubjectiveQuestion() {
    currentQuestionIndex++;
    if(currentQuestionIndex < subjectiveQuestions.length) {
        displaySubjectiveQuestion();
    } else {
        alert("You have completed all the questions!");
        goBackToModes();
    }
}


// --- FLASHCARD MODE ---
async function startFlashcards() {
  showLoader('Creating flashcards...');
  try {
      const result = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `Extract key terms and their concise definitions from the following document to create flashcards. \n\nDOCUMENT:\n${documentContent}`,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    flashcards: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                term: { type: Type.STRING },
                                definition: { type: Type.STRING }
                            },
                             required: ['term', 'definition']
                        }
                    }
                }
            }
        }
    });

    const parsedResponse = JSON.parse(result.text);
    const flashcards: Flashcard[] = parsedResponse.flashcards;
    
    if (!flashcards || flashcards.length === 0) {
      throw new Error("Could not generate flashcards from this document.");
    }
    
    displayFlashcards(flashcards);
    showView(flashcardView);
  } catch(error) {
    console.error(error);
    displayError("Failed to create flashcards.");
    showView(modeSelectView);
  } finally {
    hideLoader();
  }
}

function displayFlashcards(flashcards: Flashcard[]) {
  flashcardView.innerHTML = '';
  flashcards.forEach(flashcard => {
    const cardDiv = document.createElement('div');
    cardDiv.classList.add('flashcard');
    cardDiv.innerHTML = `
      <div class="flashcard-inner">
        <div class="flashcard-front">
          <div class="term">${flashcard.term}</div>
        </div>
        <div class="flashcard-back">
          <div class="definition">${flashcard.definition}</div>
        </div>
      </div>
    `;
    cardDiv.addEventListener('click', () => cardDiv.classList.toggle('flipped'));
    flashcardView.appendChild(cardDiv);
  });
}

// --- NAVIGATION & INITIALIZATION ---
function goBackToModes() {
    showView(modeSelectView);
    // Reset specific UI states
    nextSubjectiveBtn.textContent = 'Next Question';
}

function init() {
  fileInput.addEventListener('change', handleFileSelect);
  quizModeBtn.addEventListener('click', startQuiz);
  subjectiveModeBtn.addEventListener('click', startSubjective);
  flashcardModeBtn.addEventListener('click', startFlashcards);
  nextQuestionBtn.addEventListener('click', nextQuestion);
  restartQuizBtn.addEventListener('click', startQuiz);
  nextSubjectiveBtn.addEventListener('click', nextSubjectiveQuestion);
  backButton.addEventListener('click', goBackToModes);

  showView(uploadView);
}

init();
