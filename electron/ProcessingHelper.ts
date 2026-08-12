// ProcessingHelper.ts
import fs from "node:fs"
import path from "node:path"
import { ScreenshotHelper } from "./ScreenshotHelper"
import { IProcessingHelperDeps } from "./main"
import * as axios from "axios"
import { app, BrowserWindow, dialog } from "electron"
import { OpenAI, toFile } from "openai"
import { configHelper } from "./ConfigHelper"
import Anthropic from '@anthropic-ai/sdk';
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/messages/messages"
import type { VoiceIntent } from "../src/types/voice"

// Interface for Gemini API requests
interface GeminiMessage {
  role: string;
  parts: Array<{
    text?: string;
    inlineData?: {
      mimeType: string;
      data: string;
    }
  }>;
}

interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{
        text: string;
      }>;
    };
    finishReason: string;
  }>;
}
interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: Array<{
    type: 'text' | 'image';
    text?: string;
    source?: {
      type: 'base64';
      media_type: string;
      data: string;
    };
  }>;
}

interface VoiceAnswerParams {
  requestId: string;
  intent: VoiceIntent;
  transcript: string;
  screenshotBase64?: string;
  signal: AbortSignal;
  onChunk: (text: string) => void;
  onComplete: (text?: string) => void;
}

type VoiceResponseStyle = "concise" | "code-first" | "detailed"

export class ProcessingHelper {
  private deps: IProcessingHelperDeps
  private screenshotHelper: ScreenshotHelper
  private openaiClient: OpenAI | null = null
  private geminiApiKey: string | null = null
  private anthropicClient: Anthropic | null = null

  // AbortControllers for API requests
  private currentProcessingAbortController: AbortController | null = null
  private currentExtraProcessingAbortController: AbortController | null = null

  constructor(deps: IProcessingHelperDeps) {
    this.deps = deps
    this.screenshotHelper = deps.getScreenshotHelper()
    
    // Initialize AI client based on config
    this.initializeAIClient();
    
    // Listen for config changes to re-initialize the AI client
    configHelper.on('config-updated', () => {
      this.initializeAIClient();
    });
  }
  
  /**
   * Initialize or reinitialize the AI client with current config
   */
  private initializeAIClient(): void {
    try {
      const config = configHelper.loadConfig();
      
      if (config.apiProvider === "openai") {
        if (config.apiKey) {
          this.openaiClient = new OpenAI({ 
            apiKey: config.apiKey,
            timeout: 60000, // 60 second timeout
            maxRetries: 2   // Retry up to 2 times
          });
          this.geminiApiKey = null;
          this.anthropicClient = null;
          console.log("OpenAI client initialized successfully");
        } else {
          this.openaiClient = null;
          this.geminiApiKey = null;
          this.anthropicClient = null;
          console.warn("No API key available, OpenAI client not initialized");
        }
      } else if (config.apiProvider === "gemini"){
        // Gemini client initialization
        this.openaiClient = null;
        this.anthropicClient = null;
        if (config.apiKey) {
          this.geminiApiKey = config.apiKey;
          console.log("Gemini API key set successfully");
        } else {
          this.openaiClient = null;
          this.geminiApiKey = null;
          this.anthropicClient = null;
          console.warn("No API key available, Gemini client not initialized");
        }
      } else if (config.apiProvider === "anthropic") {
        // Reset other clients
        this.openaiClient = null;
        this.geminiApiKey = null;
        if (config.apiKey) {
          this.anthropicClient = new Anthropic({
            apiKey: config.apiKey,
            timeout: 60000,
            maxRetries: 2
          });
          console.log("Anthropic client initialized successfully");
        } else {
          this.openaiClient = null;
          this.geminiApiKey = null;
          this.anthropicClient = null;
          console.warn("No API key available, Anthropic client not initialized");
        }
      }
    } catch (error) {
      console.error("Failed to initialize AI client:", error);
      this.openaiClient = null;
      this.geminiApiKey = null;
      this.anthropicClient = null;
    }
  }

  private isGpt5Model(model: string): boolean {
    return /^gpt-5(?:[.-]|$)/i.test(model);
  }

  private getOpenAITokenLimitParam(
    model: string,
    maxTokens: number
  ): { max_tokens: number } | { max_completion_tokens: number } {
    return this.isGpt5Model(model)
      ? { max_completion_tokens: maxTokens }
      : { max_tokens: maxTokens };
  }

  private getOpenAITemperatureParam(
    model: string,
    temperature: number
  ): { temperature: number } | Record<string, never> {
    return this.isGpt5Model(model) ? {} : { temperature };
  }

  private getSqlQuestionGuidance(): string {
    return `SQL question handling:
- Treat SQL, database, schema, table, column, row, join, aggregate, window function, CTE, subquery, index, query plan, and result-set prompts as first-class coding interview questions.
- Clearly distinguish SQL tables from pandas DataFrames. If the prompt shows SQL tables, schemas, rows, or asks for a query, answer with SQL and database terminology.
- Do not convert a SQL question into pandas/Python unless the prompt explicitly asks for pandas, DataFrames, or Python data analysis.
- For SQL solutions, provide the query first, then a concise explanation of joins, filters, grouping, ordering, window functions, and edge cases.
- For SQL debugging, inspect table names, aliases, join keys, NULL handling, aggregation level, WHERE vs HAVING, window partitions/order, and dialect-specific syntax before suggesting fixes.`;
  }

  private getProblemExtractionGuidance(language: string): string {
    return `You are a coding challenge interpreter. Analyze the screenshots of the coding problem and extract all relevant information. Return the information in JSON format with these fields: problem_statement, constraints, example_input, example_output, code_explanation, data_flow, high_level_design, low_level_design. Just return the structured JSON without any other text.

Preferred coding language: ${language}.

${this.getSqlQuestionGuidance()}

When the screenshot contains SQL tables, schemas, sample rows, query text, or expected result sets, preserve table names, column names, relationships, and expected output in the extracted fields. Mark it as a SQL/database problem in the problem_statement wording instead of describing it as a pandas/DataFrame task.`;
  }

  private async waitForInitialization(
    mainWindow: BrowserWindow
  ): Promise<void> {
    let attempts = 0
    const maxAttempts = 50 // 5 seconds total

    while (attempts < maxAttempts) {
      const isInitialized = await mainWindow.webContents.executeJavaScript(
        "window.__IS_INITIALIZED__"
      )
      if (isInitialized) return
      await new Promise((resolve) => setTimeout(resolve, 100))
      attempts++
    }
    throw new Error("App failed to initialize after 5 seconds")
  }

  private async getCredits(): Promise<number> {
    const mainWindow = this.deps.getMainWindow()
    if (!mainWindow) return 999 // Unlimited credits in this version

    try {
      await this.waitForInitialization(mainWindow)
      return 999 // Always return sufficient credits to work
    } catch (error) {
      console.error("Error getting credits:", error)
      return 999 // Unlimited credits as fallback
    }
  }

  private async getLanguage(): Promise<string> {
    try {
      // Get language from config
      const config = configHelper.loadConfig();
      if (config.language) {
        return config.language;
      }
      
      // Fallback to window variable if config doesn't have language
      const mainWindow = this.deps.getMainWindow()
      if (mainWindow) {
        try {
          await this.waitForInitialization(mainWindow)
          const language = await mainWindow.webContents.executeJavaScript(
            "window.__LANGUAGE__"
          )

          if (
            typeof language === "string" &&
            language !== undefined &&
            language !== null
          ) {
            return language;
          }
        } catch (err) {
          console.warn("Could not get language from window", err);
        }
      }
      
      // Default fallback
      return "python";
    } catch (error) {
      console.error("Error getting language:", error)
      return "python"
    }
  }

  public async processScreenshots(): Promise<void> {
    const mainWindow = this.deps.getMainWindow()
    if (!mainWindow) return

    const config = configHelper.loadConfig();
    
    // First verify we have a valid AI client
    if (config.apiProvider === "openai" && !this.openaiClient) {
      this.initializeAIClient();
      
      if (!this.openaiClient) {
        console.error("OpenAI client not initialized");
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.API_KEY_INVALID
        );
        return;
      }
    } else if (config.apiProvider === "gemini" && !this.geminiApiKey) {
      this.initializeAIClient();
      
      if (!this.geminiApiKey) {
        console.error("Gemini API key not initialized");
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.API_KEY_INVALID
        );
        return;
      }
    } else if (config.apiProvider === "anthropic" && !this.anthropicClient) {
      // Add check for Anthropic client
      this.initializeAIClient();
      
      if (!this.anthropicClient) {
        console.error("Anthropic client not initialized");
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.API_KEY_INVALID
        );
        return;
      }
    }

    const view = this.deps.getView()
    console.log("Processing screenshots in view:", view)

    if (view === "queue") {
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.INITIAL_START)
      const screenshotQueue = this.screenshotHelper.getScreenshotQueue()
      console.log("Processing main queue screenshots:", screenshotQueue)
      
      // Check if the queue is empty
      if (!screenshotQueue || screenshotQueue.length === 0) {
        console.log("No screenshots found in queue");
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS);
        return;
      }

      // Check that files actually exist
      const existingScreenshots = screenshotQueue.filter(path => fs.existsSync(path));
      if (existingScreenshots.length === 0) {
        console.log("Screenshot files don't exist on disk");
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS);
        return;
      }

      try {
        // Initialize AbortController
        this.currentProcessingAbortController = new AbortController()
        const { signal } = this.currentProcessingAbortController

        const screenshots = await Promise.all(
          existingScreenshots.map(async (path) => {
            try {
              return {
                path,
                preview: await this.screenshotHelper.getImagePreview(path),
                data: fs.readFileSync(path).toString('base64')
              };
            } catch (err) {
              console.error(`Error reading screenshot ${path}:`, err);
              return null;
            }
          })
        )

        // Filter out any nulls from failed screenshots
        const validScreenshots = screenshots.filter(Boolean);
        
        if (validScreenshots.length === 0) {
          throw new Error("Failed to load screenshot data");
        }

        const result = await this.processScreenshotsHelper(validScreenshots, signal)

        if (!result.success) {
          console.log("Processing failed:", result.error)
          if (result.error?.includes("API Key") || result.error?.includes("OpenAI") || result.error?.includes("Gemini")) {
            mainWindow.webContents.send(
              this.deps.PROCESSING_EVENTS.API_KEY_INVALID
            )
          } else {
            mainWindow.webContents.send(
              this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
              result.error
            )
          }
          // Reset view back to queue on error
          console.log("Resetting view to queue due to error")
          this.deps.setView("queue")
          return
        }

        // Only set view to solutions if processing succeeded
        console.log("Setting view to solutions after successful processing")
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.SOLUTION_SUCCESS,
          result.data
        )
        this.deps.setView("solutions")
      } catch (error: any) {
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
          error
        )
        console.error("Processing error:", error)
        if (axios.isCancel(error)) {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
            "Processing was canceled by the user."
          )
        } else {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
            error.message || "Server error. Please try again."
          )
        }
        // Reset view back to queue on error
        console.log("Resetting view to queue due to error")
        this.deps.setView("queue")
      } finally {
        this.currentProcessingAbortController = null
      }
    } else {
      // view == 'solutions'
      const extraScreenshotQueue =
        this.screenshotHelper.getExtraScreenshotQueue()
      console.log("Processing extra queue screenshots:", extraScreenshotQueue)
      
      // Check if the extra queue is empty
      if (!extraScreenshotQueue || extraScreenshotQueue.length === 0) {
        console.log("No extra screenshots found in queue");
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS);
        
        return;
      }

      // Check that files actually exist
      const existingExtraScreenshots = extraScreenshotQueue.filter(path => fs.existsSync(path));
      if (existingExtraScreenshots.length === 0) {
        console.log("Extra screenshot files don't exist on disk");
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS);
        return;
      }
      
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.DEBUG_START)

      // Initialize AbortController
      this.currentExtraProcessingAbortController = new AbortController()
      const { signal } = this.currentExtraProcessingAbortController

      try {
        // Get all screenshots (both main and extra) for processing
        const allPaths = [
          ...this.screenshotHelper.getScreenshotQueue(),
          ...existingExtraScreenshots
        ];
        
        const screenshots = await Promise.all(
          allPaths.map(async (path) => {
            try {
              if (!fs.existsSync(path)) {
                console.warn(`Screenshot file does not exist: ${path}`);
                return null;
              }
              
              return {
                path,
                preview: await this.screenshotHelper.getImagePreview(path),
                data: fs.readFileSync(path).toString('base64')
              };
            } catch (err) {
              console.error(`Error reading screenshot ${path}:`, err);
              return null;
            }
          })
        )
        
        // Filter out any nulls from failed screenshots
        const validScreenshots = screenshots.filter(Boolean);
        
        if (validScreenshots.length === 0) {
          throw new Error("Failed to load screenshot data for debugging");
        }
        
        console.log(
          "Combined screenshots for processing:",
          validScreenshots.map((s) => s.path)
        )

        const result = await this.processExtraScreenshotsHelper(
          validScreenshots,
          signal
        )

        if (result.success) {
          this.deps.setHasDebugged(true)
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.DEBUG_SUCCESS,
            result.data
          )
        } else {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.DEBUG_ERROR,
            result.error
          )
        }
      } catch (error: any) {
        if (axios.isCancel(error)) {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.DEBUG_ERROR,
            "Extra processing was canceled by the user."
          )
        } else {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.DEBUG_ERROR,
            error.message
          )
        }
      } finally {
        this.currentExtraProcessingAbortController = null
      }
    }
  }

  private async processScreenshotsHelper(
    screenshots: Array<{ path: string; data: string }>,
    signal: AbortSignal
  ) {
    try {
      const config = configHelper.loadConfig();
      const language = await this.getLanguage();
      const mainWindow = this.deps.getMainWindow();
      
      // Step 1: Extract problem info using AI Vision API (OpenAI or Gemini)
      const imageDataList = screenshots.map(screenshot => screenshot.data);
      
      // Update the user on progress
      if (mainWindow) {
        mainWindow.webContents.send("processing-status", {
          message: "Analyzing problem from screenshots...",
          progress: 20
        });
      }

      let problemInfo;
      
      if (config.apiProvider === "openai") {
        // Verify OpenAI client
        if (!this.openaiClient) {
          this.initializeAIClient(); // Try to reinitialize
          
          if (!this.openaiClient) {
            return {
              success: false,
              error: "OpenAI API key not configured or invalid. Please check your settings."
            };
          }
        }

        // Use OpenAI for processing
        const messages = [
          {
            role: "system" as const, 
            content: this.getProblemExtractionGuidance(language)
          },
          {
            role: "user" as const,
            content: [
              {
                type: "text" as const, 
                text: `Extract the coding problem details from these screenshots. Return in JSON format. Preferred coding language we gonna use for this problem is ${language}.\n\n${this.getSqlQuestionGuidance()}`
              },
              ...imageDataList.map(data => ({
                type: "image_url" as const,
                image_url: { url: `data:image/png;base64,${data}` }
              }))
            ]
          }
        ];

        // Send to OpenAI Vision API
        const extractionModel = config.extractionModel || "gpt-4o";
        const extractionResponse = await this.openaiClient.chat.completions.create({
          model: extractionModel,
          messages: messages,
          ...this.getOpenAITokenLimitParam(extractionModel, 8000),
          ...this.getOpenAITemperatureParam(extractionModel, 0.2)
        });

        // Parse the response
        try {
          const responseText = extractionResponse.choices[0].message.content;
          // Handle when OpenAI might wrap the JSON in markdown code blocks
          const jsonText = responseText.replace(/```json|```/g, '').trim();
          problemInfo = JSON.parse(jsonText);
        } catch (error) {
          console.error("Error parsing OpenAI response:", error);
          return {
            success: false,
            error: "Failed to parse problem information. Please try again or use clearer screenshots."
          };
        }
      } else if (config.apiProvider === "gemini")  {
        // Use Gemini API
        if (!this.geminiApiKey) {
          return {
            success: false,
            error: "Gemini API key not configured. Please check your settings."
          };
        }

        try {
          // Create Gemini message structure
          const geminiMessages: GeminiMessage[] = [
            {
              role: "user",
              parts: [
                {
                  text: this.getProblemExtractionGuidance(language)
                },
                ...imageDataList.map(data => ({
                  inlineData: {
                    mimeType: "image/png",
                    data: data
                  }
                }))
              ]
            }
          ];

          // Make API request to Gemini
          const response = await axios.default.post(
            `https://generativelanguage.googleapis.com/v1beta/models/${config.extractionModel || "gemini-2.0-flash"}:generateContent?key=${this.geminiApiKey}`,
            {
              contents: geminiMessages,
              generationConfig: {
                temperature: 0.2,
                maxOutputTokens: 4000
              }
            },
            { signal }
          );

          const responseData = response.data as GeminiResponse;
          
          if (!responseData.candidates || responseData.candidates.length === 0) {
            throw new Error("Empty response from Gemini API");
          }
          
          const responseText = responseData.candidates[0].content.parts[0].text;
          
          // Handle when Gemini might wrap the JSON in markdown code blocks
          const jsonText = responseText.replace(/```json|```/g, '').trim();
          problemInfo = JSON.parse(jsonText);
        } catch (error) {
          console.error("Error using Gemini API:", error);
          return {
            success: false,
            error: "Failed to process with Gemini API. Please check your API key or try again later."
          };
        }
      } else if (config.apiProvider === "anthropic") {
        if (!this.anthropicClient) {
          return {
            success: false,
            error: "Anthropic API key not configured. Please check your settings."
          };
        }

        try {
          const messages = [
            {
              role: "user" as const,
              content: [
                {
                  type: "text" as const,
                  text: this.getProblemExtractionGuidance(language)
                },
                ...imageDataList.map(data => ({
                  type: "image" as const,
                  source: {
                    type: "base64" as const,
                    media_type: "image/png" as const,
                    data: data
                  }
                }))
              ]
            }
          ];

          const response = await this.anthropicClient.messages.create({
            model: config.extractionModel || "claude-3-7-sonnet-20250219",
            max_tokens: 4000,
            messages: messages,
            temperature: 0.2
          });

          const responseText = (response.content[0] as { type: 'text', text: string }).text;
          const jsonText = responseText.replace(/```json|```/g, '').trim();
          problemInfo = JSON.parse(jsonText);
        } catch (error: any) {
          console.error("Error using Anthropic API:", error);

          // Add specific handling for Claude's limitations
          if (error.status === 429) {
            return {
              success: false,
              error: "Claude API rate limit exceeded. Please wait a few minutes before trying again."
            };
          } else if (error.status === 413 || (error.message && error.message.includes("token"))) {
            return {
              success: false,
              error: "Your screenshots contain too much information for Claude to process. Switch to OpenAI or Gemini in settings which can handle larger inputs."
            };
          }

          return {
            success: false,
            error: "Failed to process with Anthropic API. Please check your API key or try again later."
          };
        }
      }
      
      // Update the user on progress
      if (mainWindow) {
        mainWindow.webContents.send("processing-status", {
          message: "Problem analyzed successfully. Preparing to generate solution...",
          progress: 40
        });
      }

      // Store problem info in AppState
      this.deps.setProblemInfo(problemInfo);

      // Send first success event
      if (mainWindow) {
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.PROBLEM_EXTRACTED,
          problemInfo
        );

        // Generate solutions after successful extraction
        const solutionsResult = await this.generateSolutionsHelper(signal);
        if (solutionsResult.success) {
          // Clear any existing extra screenshots before transitioning to solutions view
          this.screenshotHelper.clearExtraScreenshotQueue();
          
          // Final progress update
          mainWindow.webContents.send("processing-status", {
            message: "Solution generated successfully",
            progress: 100
          });
          
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.SOLUTION_SUCCESS,
            solutionsResult.data
          );
          return { success: true, data: solutionsResult.data };
        } else {
          throw new Error(
            solutionsResult.error || "Failed to generate solutions"
          );
        }
      }

      return { success: false, error: "Failed to process screenshots" };
    } catch (error: any) {
      // If the request was cancelled, don't retry
      if (axios.isCancel(error)) {
        return {
          success: false,
          error: "Processing was canceled by the user."
        };
      }
      
      // Handle OpenAI API errors specifically
      if (error?.response?.status === 401) {
        return {
          success: false,
          error: "Invalid OpenAI API key. Please check your settings."
        };
      } else if (error?.response?.status === 429) {
        return {
          success: false,
          error: "OpenAI API rate limit exceeded or insufficient credits. Please try again later."
        };
      } else if (error?.response?.status === 500) {
        return {
          success: false,
          error: "OpenAI server error. Please try again later."
        };
      }

      console.error("API Error Details:", error);
      return { 
        success: false, 
        error: error.message || "Failed to process screenshots. Please try again." 
      };
    }
  }

  private async generateSolutionsHelper(signal: AbortSignal) {
    try {
      const problemInfo = this.deps.getProblemInfo();
      const language = await this.getLanguage();
      const config = configHelper.loadConfig();
      const mainWindow = this.deps.getMainWindow();

      if (!problemInfo) {
        throw new Error("No problem info available");
      }

      // Update progress status
      if (mainWindow) {
        mainWindow.webContents.send("processing-status", {
          message: "Creating optimal solution with detailed explanations...",
          progress: 60
        });
      }

      // Create prompt for solution generation
      const promptText = `
Generate a detailed solution for the following coding problem:

PROBLEM STATEMENT:
${problemInfo.problem_statement}

CONSTRAINTS:
${problemInfo.constraints || "No specific constraints provided."}

EXAMPLE INPUT:
${problemInfo.example_input || "No example input provided."}

EXAMPLE OUTPUT:
${problemInfo.example_output || "No example output provided."}

LANGUAGE: ${language}

${this.getSqlQuestionGuidance()}

I need the response in the following format:
1. Code: A clean, optimized implementation in ${language}
2. Your Thoughts: A list of key insights and reasoning behind your approach
3. Time complexity: O(X) with a detailed explanation (at least 2 sentences)
4. Space complexity: O(X) with a detailed explanation (at least 2 sentences)
5. High-level design: A brief overview of the overall approach and structure of the solution
6. Low-level design: A more detailed explanation of the specific techniques, data structures, and algorithms used in the solution should be well-commented to explain the logic.
7. Data flow: Describe how data moves through the solution, including how inputs are transformed into outputs.
8. HLD Diagram: A compact ASCII diagram using only keyboard characters (for example: A -> B -> C, with optional | and - lines)
9. LLD Diagram: A compact ASCII diagram using only keyboard characters (for example: A -> B -> C, with optional | and - lines)
10. Data Flow Diagram: A compact ASCII diagram using only keyboard characters (for example: Input -> Service -> DB -> Output)

For complexity explanations, please be thorough. For example: "Time complexity: O(n) because we iterate through the array only once. This is optimal as we need to examine each element at least once to find the solution." or "Space complexity: O(n) because in the worst case, we store all elements in the hashmap. The additional space scales linearly with the input size."

Your solution should be efficient, well-commented, and handle edge cases. For SQL questions, the Code section must contain the SQL query unless pandas/Python is explicitly requested.
`;

      let responseContent = "";
      
      if (config.apiProvider === "openai") {
        // OpenAI processing
        if (!this.openaiClient) {
          return {
            success: false,
            error: "OpenAI API key not configured. Please check your settings."
          };
        }
        
        // Send to OpenAI API
        const solutionModel = config.solutionModel || "gpt-4o";
        const stream = await this.openaiClient.chat.completions.create(
          {
            model: solutionModel,
            messages: [
              { role: "system", content: `You are an expert coding interview assistant. Provide clear, optimal solutions with detailed explanations.\n\n${this.getSqlQuestionGuidance()}` },
              { role: "user", content: promptText }
            ],
            ...this.getOpenAITokenLimitParam(solutionModel, 8000),
            ...this.getOpenAITemperatureParam(solutionModel, 0.2),
            stream: true
          },
          { signal }
        );

        let pendingStreamText = "";
        let lastStreamEmitAt = 0;
        const flushStreamText = () => {
          if (!mainWindow || pendingStreamText.length === 0) {
            return;
          }

          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.SOLUTION_STREAM,
            pendingStreamText
          );
          pendingStreamText = "";
          lastStreamEmitAt = Date.now();
        };

        for await (const chunk of stream) {
          if (signal.aborted) {
            throw new Error("Processing was canceled by the user.");
          }

          const text = chunk.choices[0]?.delta?.content;
          if (!text) {
            continue;
          }

          responseContent += text;
          pendingStreamText += text;

          if (Date.now() - lastStreamEmitAt > 100) {
            flushStreamText();
          }
        }

        flushStreamText();
      } else if (config.apiProvider === "gemini")  {
        // Gemini processing
        if (!this.geminiApiKey) {
          return {
            success: false,
            error: "Gemini API key not configured. Please check your settings."
          };
        }
        
        try {
          // Create Gemini message structure
          const geminiMessages = [
            {
              role: "user",
              parts: [
                {
                  text: `You are an expert coding interview assistant. Provide a clear, optimal solution with detailed explanations for this problem:\n\n${promptText}`
                }
              ]
            }
          ];

          // Make API request to Gemini
          const response = await axios.default.post(
            `https://generativelanguage.googleapis.com/v1beta/models/${config.solutionModel || "gemini-2.0-flash"}:generateContent?key=${this.geminiApiKey}`,
            {
              contents: geminiMessages,
              generationConfig: {
                temperature: 0.2,
                maxOutputTokens: 4000
              }
            },
            { signal }
          );

          const responseData = response.data as GeminiResponse;
          
          if (!responseData.candidates || responseData.candidates.length === 0) {
            throw new Error("Empty response from Gemini API");
          }
          
          responseContent = responseData.candidates[0].content.parts[0].text;
        } catch (error) {
          console.error("Error using Gemini API for solution:", error);
          return {
            success: false,
            error: "Failed to generate solution with Gemini API. Please check your API key or try again later."
          };
        }
      } else if (config.apiProvider === "anthropic") {
        // Anthropic processing
        if (!this.anthropicClient) {
          return {
            success: false,
            error: "Anthropic API key not configured. Please check your settings."
          };
        }
        
        try {
          const messages = [
            {
              role: "user" as const,
              content: [
                {
                  type: "text" as const,
                  text: `You are an expert coding interview assistant. Provide a clear, optimal solution with detailed explanations for this problem:\n\n${promptText}`
                }
              ]
            }
          ];

          // Send to Anthropic API
          const response = await this.anthropicClient.messages.create({
            model: config.solutionModel || "claude-3-7-sonnet-20250219",
            max_tokens: 4000,
            messages: messages,
            temperature: 0.2
          });

          responseContent = (response.content[0] as { type: 'text', text: string }).text;
        } catch (error: any) {
          console.error("Error using Anthropic API for solution:", error);

          // Add specific handling for Claude's limitations
          if (error.status === 429) {
            return {
              success: false,
              error: "Claude API rate limit exceeded. Please wait a few minutes before trying again."
            };
          } else if (error.status === 413 || (error.message && error.message.includes("token"))) {
            return {
              success: false,
              error: "Your screenshots contain too much information for Claude to process. Switch to OpenAI or Gemini in settings which can handle larger inputs."
            };
          }

          return {
            success: false,
            error: "Failed to generate solution with Anthropic API. Please check your API key or try again later."
          };
        }
      }
      
      // Extract parts from the response
      const codeMatch = responseContent.match(/```(?:\w+)?\s*([\s\S]*?)```/);
      const code = codeMatch ? codeMatch[1].trim() : responseContent;
      
      // Extract thoughts, looking for bullet points or numbered lists
      const thoughtsRegex = /(?:Thoughts:|Key Insights:|Reasoning:|Approach:)([\s\S]*?)(?:Time complexity:|$)/i;
      const thoughtsMatch = responseContent.match(thoughtsRegex);
      let thoughts: string[] = [];
      
      if (thoughtsMatch && thoughtsMatch[1]) {
        // Extract bullet points or numbered items
        const bulletPoints = thoughtsMatch[1].match(/(?:^|\n)\s*(?:[-*•]|\d+\.)\s*(.*)/g);
        if (bulletPoints) {
          thoughts = bulletPoints.map(point => 
            point.replace(/^\s*(?:[-*•]|\d+\.)\s*/, '').trim()
          ).filter(Boolean);
        } else {
          // If no bullet points found, split by newlines and filter empty lines
          thoughts = thoughtsMatch[1].split('\n')
            .map((line) => line.trim())
            .filter(Boolean);
        }
      }
      
      // Extract complexity information
      const timeComplexityPattern = /Time complexity:?\s*([^\n]+(?:\n[^\n]+)*?)(?=\n\s*(?:Space complexity|$))/i;
      const spaceComplexityPattern = /Space complexity:?\s*([^\n]+(?:\n[^\n]+)*?)(?=\n\s*(?:[A-Z]|$))/i;
      
      let timeComplexity = "O(n) - Linear time complexity because we only iterate through the array once. Each element is processed exactly one time, and the hashmap lookups are O(1) operations.";
      let spaceComplexity = "O(n) - Linear space complexity because we store elements in the hashmap. In the worst case, we might need to store all elements before finding the solution pair.";
      
      const timeMatch = responseContent.match(timeComplexityPattern);
      if (timeMatch && timeMatch[1]) {
        timeComplexity = timeMatch[1].trim();
        if (!timeComplexity.match(/O\([^)]+\)/i)) {
          timeComplexity = `O(n) - ${timeComplexity}`;
        } else if (!timeComplexity.includes('-') && !timeComplexity.includes('because')) {
          const notationMatch = timeComplexity.match(/O\([^)]+\)/i);
          if (notationMatch) {
            const notation = notationMatch[0];
            const rest = timeComplexity.replace(notation, '').trim();
            timeComplexity = `${notation} - ${rest}`;
          }
        }
      }
      
      const spaceMatch = responseContent.match(spaceComplexityPattern);
      if (spaceMatch && spaceMatch[1]) {
        spaceComplexity = spaceMatch[1].trim();
        if (!spaceComplexity.match(/O\([^)]+\)/i)) {
          spaceComplexity = `O(n) - ${spaceComplexity}`;
        } else if (!spaceComplexity.includes('-') && !spaceComplexity.includes('because')) {
          const notationMatch = spaceComplexity.match(/O\([^)]+\)/i);
          if (notationMatch) {
            const notation = notationMatch[0];
            const rest = spaceComplexity.replace(notation, '').trim();
            spaceComplexity = `${notation} - ${rest}`;
          }
        }
      }

      const extractSection = (labels: string[]): string | null => {
        const headingRegex = /(?:^|\n)\s*(?:#{1,6}\s*)?(?:\d+\s*[\).:-]\s*)?(Code|Your Thoughts|Thoughts|Key Insights|Reasoning|Approach|Explanation|Code Explanation|Time complexity|Space complexity|High-level design|High level design|Low-level design|Low level design|Data flow|Dataflow|HLD Diagram|LLD Diagram|Data Flow Diagram|High-level design diagram|High level design diagram|Low-level design diagram|Low level design diagram|Data flow diagram|Dataflow diagram|High-level diagram|High level diagram|Low-level diagram|Low level diagram)\s*:?([^\n]*)/gi;
        const matches = Array.from(responseContent.matchAll(headingRegex)).map((match) => ({
          start: match.index ?? 0,
          end: (match.index ?? 0) + match[0].length,
          label: (match[1] || "").trim().toLowerCase(),
          inlineContent: (match[2] || "").trim()
        }));

        const targetLabels = labels.map((label) => label.toLowerCase());
        const current = matches.find((match) => targetLabels.includes(match.label));
        if (!current) return null;

        const next = matches.find((match) => match.start > current.start);
        const bodyEnd = next ? next.start : responseContent.length;
        const body = responseContent.slice(current.end, bodyEnd).trim();
        const combined = [current.inlineContent, body].filter(Boolean).join("\n").trim();
        return combined || null;
      };

      const codeExplanation =
        extractSection(["Explanation", "Code Explanation"]) ||
        extractSection(["Thoughts", "Your Thoughts", "Key Insights", "Reasoning", "Approach"]) ||
        "Explanation was not explicitly provided.";
      const highLevelDesign =
        extractSection(["High-level design", "High level design"]) ||
        "High-level design was not explicitly provided.";
      const lowLevelDesign =
        extractSection(["Low-level design", "Low level design"]) ||
        "Low-level design was not explicitly provided.";
      const dataFlow =
        extractSection(["Data flow", "Dataflow"]) ||
        "Data flow was not explicitly provided.";
      const hldDiagram =
        extractSection(["HLD Diagram", "High-level design diagram", "High level design diagram", "High-level diagram", "High level diagram"]) ||
        this.buildFallbackDiagram("High-Level Design", highLevelDesign);
      const lldDiagram =
        extractSection(["LLD Diagram", "Low-level design diagram", "Low level design diagram", "Low-level diagram", "Low level diagram"]) ||
        this.buildFallbackDiagram("Low-Level Design", lowLevelDesign);
      const dataFlowDiagram =
        extractSection(["Data Flow Diagram", "Data flow diagram", "Dataflow diagram"]) ||
        this.buildFallbackDiagram("Data Flow", dataFlow);

      const formattedResponse = {
        code: code,
        thoughts: thoughts.length > 0 ? thoughts : ["Solution approach based on efficiency and readability"],
        time_complexity: timeComplexity,
        space_complexity: spaceComplexity,
        code_explanation: codeExplanation,
        high_level_design: highLevelDesign,
        low_level_design: lowLevelDesign,
        data_flow: dataFlow,
        hld_diagram: hldDiagram,
        lld_diagram: lldDiagram,
        data_flow_diagram: dataFlowDiagram
      };

      return { success: true, data: formattedResponse };
    } catch (error: any) {
      if (axios.isCancel(error)) {
        return {
          success: false,
          error: "Processing was canceled by the user."
        };
      }
      
      if (error?.response?.status === 401) {
        return {
          success: false,
          error: "Invalid OpenAI API key. Please check your settings."
        };
      } else if (error?.response?.status === 429) {
        return {
          success: false,
          error: "OpenAI API rate limit exceeded or insufficient credits. Please try again later."
        };
      }
      
      console.error("Solution generation error:", error);
      return { success: false, error: error.message || "Failed to generate solution" };
    }
  }

  private buildFallbackDiagram(title: string, content: string): string {
    const sanitize = (value: string): string => {
      return value
        .replace(/```[\s\S]*?```/g, "")
        .replace(/[`"]/g, "")
        .replace(/[<>]/g, "")
        .replace(/\s+/g, " ")
        .trim();
    };

    const steps = content
      .split("\n")
      .map((line) => sanitize(line.replace(/^[-*]\s*/, "")))
      .filter(Boolean)
      .slice(0, 6);

    let nodes = steps.length > 0 ? steps : ["Input", title, "Output"];
    if (nodes.length === 1) {
      nodes = ["Input", nodes[0], "Output"];
    }

    return nodes.join(" -> ");
  }

  public async streamVoiceAnswer(params: VoiceAnswerParams): Promise<void> {
    const config = configHelper.loadConfig();
    const language = await this.getLanguage();
    const prompt = this.buildVoicePrompt(
      params.intent,
      params.transcript,
      language,
      config.voiceResponseStyle
    );

    this.throwIfVoiceRequestAborted(params.signal);

    if (config.apiProvider === "openai") {
      if (!this.openaiClient) {
        this.initializeAIClient();
      }

      if (!this.openaiClient) {
        throw new Error("OpenAI API key not configured. Please check your settings.");
      }

      const userContent: Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      > = [{ type: "text", text: prompt }];

      if (params.screenshotBase64) {
        userContent.push({
          type: "image_url",
          image_url: {
            url: `data:image/png;base64,${params.screenshotBase64}`
          }
        });
      }

      const voiceModel = config.solutionModel || "gpt-4o";
      const stream = await this.openaiClient.chat.completions.create(
        {
          model: voiceModel,
          messages: [
            {
              role: "system",
              content:
                `You are a concise software-engineering interview assistant. Answer software engineering interview questions across coding, backend, frontend, infrastructure, distributed systems, data systems, debugging, complexity, system design, and behavioral experience questions about engineering work. When a transcript is ambiguous, answer it if it could plausibly be a technical interview question. Briefly decline only clearly non-engineering topics.\n\n${this.getSqlQuestionGuidance()}`
            },
            {
              role: "user",
              content: userContent
            }
          ],
          ...this.getOpenAITokenLimitParam(voiceModel, 2500),
          ...this.getOpenAITemperatureParam(voiceModel, 0.2),
          stream: true
        },
        { signal: params.signal }
      );

      let fullText = "";
      for await (const chunk of stream) {
        this.throwIfVoiceRequestAborted(params.signal);
        const text = chunk.choices[0]?.delta?.content;
        if (text) {
          fullText += text;
          params.onChunk(text);
        }
      }

      params.onComplete(fullText);
      return;
    }

    if (config.apiProvider === "gemini") {
      const finalText = await this.generateVoiceAnswerWithGemini(
        prompt,
        params.screenshotBase64,
        params.signal
      );
      params.onComplete(finalText);
      return;
    }

    if (config.apiProvider === "anthropic") {
      const finalText = await this.generateVoiceAnswerWithAnthropic(
        prompt,
        params.screenshotBase64,
        params.signal
      );
      params.onComplete(finalText);
      return;
    }

    throw new Error("Unsupported AI provider for voice answers.");
  }

  public async transcribeVoiceAudio(params: {
    audioBase64: string;
    mimeType: string;
    language?: string;
  }): Promise<string> {
    const config = configHelper.loadConfig();

    if (config.apiProvider !== "openai") {
      throw new Error("Provider transcription fallback requires OpenAI in settings.");
    }

    if (!this.openaiClient) {
      this.initializeAIClient();
    }

    if (!this.openaiClient) {
      throw new Error("OpenAI API key not configured. Please check your settings.");
    }

    const audioBuffer = Buffer.from(params.audioBase64, "base64");
    if (audioBuffer.length === 0) {
      return "";
    }

    const extension = params.mimeType.includes("mp4")
      ? "mp4"
      : params.mimeType.includes("ogg")
        ? "ogg"
        : "webm";
    const language = params.language?.split("-")[0]?.trim() || undefined;
    const file = await toFile(audioBuffer, `voice.${extension}`, {
      type: params.mimeType
    });

    const transcription = await this.openaiClient.audio.transcriptions.create({
      file,
      model: config.voiceTranscriptionModel || "gpt-4o-transcribe",
      language,
      prompt:
        "Software engineering interview vocabulary: Kafka, message queues, event streaming, distributed systems, rate limiting, throttling, quotas, retries, exponential backoff, circuit breakers, Python, GIL, Global Interpreter Lock, Java, JavaScript, TypeScript, React, Node.js, backend, frontend, infrastructure, REST API, SQL, SQL query, database schema, table, column, row, join, aggregate, group by, having, CTE, window function, Postgres, MySQL, SQLite, Redis, Docker, Kubernetes, system design, algorithms, data structures, time complexity, space complexity, data migration, offloading data, uploading data, servers, production systems."
    });

    return transcription.text?.trim() || "";
  }

  private buildVoicePrompt(
    intent: VoiceIntent,
    transcript: string,
    language: string,
    responseStyle: VoiceResponseStyle = "concise"
  ): string {
    const intentInstructions: Record<VoiceIntent, string> = {
      solve:
        "For a coding problem, give the approach in 1-2 lines, then provide clean code, then time and space complexity.",
      explain:
        "Explain the approach clearly and briefly. Prioritize what to say out loud in an interview.",
      complexity:
        "Focus on time complexity and space complexity. Include the reason for each bound.",
      debug:
        "Find likely issues in the visible code or failing output. Give the smallest concrete fix first."
    };

    const styleInstructions: Record<VoiceResponseStyle, string> = {
      concise:
        "Use short sections and keep the whole answer compact unless code is required.",
      "code-first":
        "For coding prompts, provide the code before extended explanation. Keep non-code text minimal.",
      detailed:
        "Include a fuller explanation with edge cases and reasoning after the direct answer."
    };

    return `You are helping with a software-engineering interview practice prompt. Use the screen image and transcript.

Intent: ${intent}
Preferred language: ${language}
Response style: ${responseStyle}
Transcript: "${transcript}"

Scope:
- Answer software engineering interview questions across coding, backend, frontend, infrastructure, distributed systems, data systems, debugging, complexity, architecture, and system design.
- Treat behavioral or experience questions as in scope when they involve engineering work, for example uploading, offloading, migrating, syncing, or serving data across servers or services.
- Treat near-match speech recognition terms as technical vocabulary when context supports it, for example "JIL" or "GIM" in Python means "GIL".
- When the transcript is ambiguous, answer it if it could plausibly be a technical interview question.
- Treat SQL questions and queries as in-scope coding interview prompts. Distinguish SQL tables from pandas DataFrames, and answer SQL table/schema/query prompts with SQL unless pandas is explicitly requested.
- Only use the off-topic reply for clearly non-engineering topics.
- Keep the answer interview-ready: prioritize what the candidate should say, then the implementation or reasoning.

${this.getSqlQuestionGuidance()}

${intentInstructions[intent]}
${styleInstructions[responseStyle]}

Respond immediately with the most useful answer first. Keep it stream-friendly and formatted in markdown.`;
  }

  private async generateVoiceAnswerWithGemini(
    prompt: string,
    screenshotBase64: string | undefined,
    signal: AbortSignal
  ): Promise<string> {
    if (!this.geminiApiKey) {
      this.initializeAIClient();
    }

    if (!this.geminiApiKey) {
      throw new Error("Gemini API key not configured. Please check your settings.");
    }

    const parts: GeminiMessage["parts"] = [{ text: prompt }];
    if (screenshotBase64) {
      parts.push({
        inlineData: {
          mimeType: "image/png",
          data: screenshotBase64
        }
      });
    }

    const config = configHelper.loadConfig();
    const response = await axios.default.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${config.solutionModel || "gemini-2.0-flash"}:generateContent?key=${this.geminiApiKey}`,
      {
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 2500
        }
      },
      { signal }
    );

    this.throwIfVoiceRequestAborted(signal);

    const responseData = response.data as GeminiResponse;
    const text = responseData.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error("Empty response from Gemini API.");
    }

    return text;
  }

  private async generateVoiceAnswerWithAnthropic(
    prompt: string,
    screenshotBase64: string | undefined,
    signal: AbortSignal
  ): Promise<string> {
    if (!this.anthropicClient) {
      this.initializeAIClient();
    }

    if (!this.anthropicClient) {
      throw new Error("Anthropic API key not configured. Please check your settings.");
    }

    const content: ContentBlockParam[] = [{ type: "text", text: prompt }];
    if (screenshotBase64) {
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png" as const,
          data: screenshotBase64
        }
      });
    }

    const config = configHelper.loadConfig();
    const response = await this.anthropicClient.messages.create(
      {
        model: config.solutionModel || "claude-3-7-sonnet-20250219",
        max_tokens: 2500,
        messages: [{ role: "user", content }],
        temperature: 0.2
      },
      { signal }
    );

    this.throwIfVoiceRequestAborted(signal);

    const text = (response.content[0] as { type: "text"; text: string } | undefined)
      ?.text;
    if (!text) {
      throw new Error("Empty response from Anthropic API.");
    }

    return text;
  }

  private throwIfVoiceRequestAborted(signal: AbortSignal): void {
    if (signal.aborted) {
      throw new Error("Voice request cancelled");
    }
  }

  private async processExtraScreenshotsHelper(
    screenshots: Array<{ path: string; data: string }>,
    signal: AbortSignal
  ) {
    try {
      const problemInfo = this.deps.getProblemInfo();
      const language = await this.getLanguage();
      const config = configHelper.loadConfig();
      const mainWindow = this.deps.getMainWindow();

      if (!problemInfo) {
        throw new Error("No problem info available");
      }

      // Update progress status
      if (mainWindow) {
        mainWindow.webContents.send("processing-status", {
          message: "Processing debug screenshots...",
          progress: 30
        });
      }

      // Prepare the images for the API call
      const imageDataList = screenshots.map(screenshot => screenshot.data);
      
      let debugContent;
      
      if (config.apiProvider === "openai") {
        if (!this.openaiClient) {
          return {
            success: false,
            error: "OpenAI API key not configured. Please check your settings."
          };
        }
        
        const messages = [
          {
            role: "system" as const, 
            content: `You are a coding interview assistant helping debug and improve solutions. Analyze these screenshots which include either error messages, incorrect outputs, or test cases, and provide detailed debugging help.

${this.getSqlQuestionGuidance()}

Your response MUST follow this exact structure with these section headers (use ### for headers):
### Issues Identified
- List each issue as a bullet point with clear explanation

### Specific Improvements and Corrections
- List specific code changes needed as bullet points

### Optimizations
- List any performance optimizations if applicable

### Explanation of Changes Needed
Here provide a clear explanation of why the changes are needed

### Key Points
- Summary bullet points of the most important takeaways

If you include code examples, use proper markdown code blocks with language specification (e.g. \`\`\`java).`
          },
          {
            role: "user" as const,
            content: [
              {
                type: "text" as const, 
                text: `I'm solving this coding problem: "${problemInfo.problem_statement}" in ${language}. I need help with debugging or improving my solution. Here are screenshots of my code, the errors or test cases. Please provide a detailed analysis with:
1. What issues you found in my code
2. Specific improvements and corrections
3. Any optimizations that would make the solution better
4. A clear explanation of the changes needed

${this.getSqlQuestionGuidance()}` 
              },
              ...imageDataList.map(data => ({
                type: "image_url" as const,
                image_url: { url: `data:image/png;base64,${data}` }
              }))
            ]
          }
        ];

        if (mainWindow) {
          mainWindow.webContents.send("processing-status", {
            message: "Analyzing code and generating debug feedback...",
            progress: 60
          });
        }

        const debuggingModel = config.debuggingModel || "gpt-4o";
        const debugResponse = await this.openaiClient.chat.completions.create({
          model: debuggingModel,
          messages: messages,
          ...this.getOpenAITokenLimitParam(debuggingModel, 8000),
          ...this.getOpenAITemperatureParam(debuggingModel, 0.2)
        });
        
        debugContent = debugResponse.choices[0].message.content;
      } else if (config.apiProvider === "gemini")  {
        if (!this.geminiApiKey) {
          return {
            success: false,
            error: "Gemini API key not configured. Please check your settings."
          };
        }
        
        try {
          const debugPrompt = `
You are a coding interview assistant helping debug and improve solutions. Analyze these screenshots which include either error messages, incorrect outputs, or test cases, and provide detailed debugging help.

I'm solving this coding problem: "${problemInfo.problem_statement}" in ${language}. I need help with debugging or improving my solution.

${this.getSqlQuestionGuidance()}

YOUR RESPONSE MUST FOLLOW THIS EXACT STRUCTURE WITH THESE SECTION HEADERS:
### Issues Identified
- List each issue as a bullet point with clear explanation

### Specific Improvements and Corrections
- List specific code changes needed as bullet points

### Optimizations
- List any performance optimizations if applicable

### Explanation of Changes Needed
Here provide a clear explanation of why the changes are needed

### Key Points
- Summary bullet points of the most important takeaways

If you include code examples, use proper markdown code blocks with language specification (e.g. \`\`\`java).
`;

          const geminiMessages = [
            {
              role: "user",
              parts: [
                { text: debugPrompt },
                ...imageDataList.map(data => ({
                  inlineData: {
                    mimeType: "image/png",
                    data: data
                  }
                }))
              ]
            }
          ];

          if (mainWindow) {
            mainWindow.webContents.send("processing-status", {
              message: "Analyzing code and generating debug feedback with Gemini...",
              progress: 60
            });
          }

          const response = await axios.default.post(
            `https://generativelanguage.googleapis.com/v1beta/models/${config.debuggingModel || "gemini-2.0-flash"}:generateContent?key=${this.geminiApiKey}`,
            {
              contents: geminiMessages,
              generationConfig: {
                temperature: 0.2,
                maxOutputTokens: 4000
              }
            },
            { signal }
          );

          const responseData = response.data as GeminiResponse;
          
          if (!responseData.candidates || responseData.candidates.length === 0) {
            throw new Error("Empty response from Gemini API");
          }
          
          debugContent = responseData.candidates[0].content.parts[0].text;
        } catch (error) {
          console.error("Error using Gemini API for debugging:", error);
          return {
            success: false,
            error: "Failed to process debug request with Gemini API. Please check your API key or try again later."
          };
        }
      } else if (config.apiProvider === "anthropic") {
        if (!this.anthropicClient) {
          return {
            success: false,
            error: "Anthropic API key not configured. Please check your settings."
          };
        }
        
        try {
          const debugPrompt = `
You are a coding interview assistant helping debug and improve solutions. Analyze these screenshots which include either error messages, incorrect outputs, or test cases, and provide detailed debugging help.

I'm solving this coding problem: "${problemInfo.problem_statement}" in ${language}. I need help with debugging or improving my solution.

${this.getSqlQuestionGuidance()}

YOUR RESPONSE MUST FOLLOW THIS EXACT STRUCTURE WITH THESE SECTION HEADERS:
### Issues Identified
- List each issue as a bullet point with clear explanation

### Specific Improvements and Corrections
- List specific code changes needed as bullet points

### Optimizations
- List any performance optimizations if applicable

### Explanation of Changes Needed
Here provide a clear explanation of why the changes are needed

### Key Points
- Summary bullet points of the most important takeaways

If you include code examples, use proper markdown code blocks with language specification.
`;

          const messages = [
            {
              role: "user" as const,
              content: [
                {
                  type: "text" as const,
                  text: debugPrompt
                },
                ...imageDataList.map(data => ({
                  type: "image" as const,
                  source: {
                    type: "base64" as const,
                    media_type: "image/png" as const, 
                    data: data
                  }
                }))
              ]
            }
          ];

          if (mainWindow) {
            mainWindow.webContents.send("processing-status", {
              message: "Analyzing code and generating debug feedback with Claude...",
              progress: 60
            });
          }

          const response = await this.anthropicClient.messages.create({
            model: config.debuggingModel || "claude-3-7-sonnet-20250219",
            max_tokens: 4000,
            messages: messages,
            temperature: 0.2
          });
          
          debugContent = (response.content[0] as { type: 'text', text: string }).text;
        } catch (error: any) {
          console.error("Error using Anthropic API for debugging:", error);
          
          // Add specific handling for Claude's limitations
          if (error.status === 429) {
            return {
              success: false,
              error: "Claude API rate limit exceeded. Please wait a few minutes before trying again."
            };
          } else if (error.status === 413 || (error.message && error.message.includes("token"))) {
            return {
              success: false,
              error: "Your screenshots contain too much information for Claude to process. Switch to OpenAI or Gemini in settings which can handle larger inputs."
            };
          }
          
          return {
            success: false,
            error: "Failed to process debug request with Anthropic API. Please check your API key or try again later."
          };
        }
      }
      
      
      if (mainWindow) {
        mainWindow.webContents.send("processing-status", {
          message: "Debug analysis complete",
          progress: 100
        });
      }

      let extractedCode = "// Debug mode - see analysis below";
      const codeMatch = debugContent.match(/```(?:[a-zA-Z]+)?([\s\S]*?)```/);
      if (codeMatch && codeMatch[1]) {
        extractedCode = codeMatch[1].trim();
      }

      let formattedDebugContent = debugContent;
      
      if (!debugContent.includes('# ') && !debugContent.includes('## ')) {
        formattedDebugContent = debugContent
          .replace(/issues identified|problems found|bugs found/i, '## Issues Identified')
          .replace(/code improvements|improvements|suggested changes/i, '## Code Improvements')
          .replace(/optimizations|performance improvements/i, '## Optimizations')
          .replace(/explanation|detailed analysis/i, '## Explanation');
      }

      const bulletPoints = formattedDebugContent.match(/(?:^|\n)[ ]*(?:[-*•]|\d+\.)[ ]+([^\n]+)/g);
      const thoughts = bulletPoints 
        ? bulletPoints.map(point => point.replace(/^[ ]*(?:[-*•]|\d+\.)[ ]+/, '').trim()).slice(0, 5)
        : ["Debug analysis based on your screenshots"];
      
      const response = {
        code: extractedCode,
        debug_analysis: formattedDebugContent,
        thoughts: thoughts,
        time_complexity: "N/A - Debug mode",
        space_complexity: "N/A - Debug mode"
      };

      return { success: true, data: response };
    } catch (error: any) {
      console.error("Debug processing error:", error);
      return { success: false, error: error.message || "Failed to process debug request" };
    }
  }

  public cancelOngoingRequests(): void {
    let wasCancelled = false

    if (this.currentProcessingAbortController) {
      this.currentProcessingAbortController.abort()
      this.currentProcessingAbortController = null
      wasCancelled = true
    }

    if (this.currentExtraProcessingAbortController) {
      this.currentExtraProcessingAbortController.abort()
      this.currentExtraProcessingAbortController = null
      wasCancelled = true
    }

    this.deps.setHasDebugged(false)

    this.deps.setProblemInfo(null)

    const mainWindow = this.deps.getMainWindow()
    if (wasCancelled && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS)
    }
  }
}
