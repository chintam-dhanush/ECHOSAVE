import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });  // This must be at the top

// Load variables
const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_ANON_KEY || "";

// Ensure credentials are valid
if (!supabaseUrl || !supabaseKey) {
    vscode.window.showErrorMessage("❌ Supabase credentials are missing! Check your .env file.");
}

// Initialize Supabase
const supabase = createClient(supabaseUrl, supabaseKey);

// Function to read stored data from Supabase
async function readStorage(code: string): Promise<any[]> {
    const { data, error } = await supabase
        .from('code_groups')
        .select('file_name,content')
        .eq('code', code);  // Assuming you have a column `code_group` to identify the code group.

    if (error) {
        vscode.window.showErrorMessage(`Error fetching data: ${error.message}`);
        return [];
    }
    return data || [];
}

// Function to write data to Supabase
async function writeStorage(code: string, fileName: string, fileContent: string) {
    try {
        const { data, error } = await supabase
            .from('code_groups')
            .upsert([
                { code: code, file_name: fileName, content: fileContent }
            ], {
                onConflict: 'code, file_name' // Ensure conflict happens if both 'code' and 'file_name' exist
            }
        );

        if (error) {
            console.error("Supabase error response:", error);  // Log the error object directly
            throw error;  // Throw the error to be caught in the catch block
        }

        vscode.window.showInformationMessage(`✅ '${fileName}' saved successfully to ${code}!`);
    } catch (error: unknown) {
        if (error instanceof Error) {
            // Standard Error handling
            console.error("Error saving file to Supabase:", error.message);
            vscode.window.showErrorMessage(`❌ Error saving file: ${error.message}`);
        } else {
            // Log the error in more detail when it is not an instance of Error
            console.error("An unknown error occurred:", JSON.stringify(error, null, 2));
            vscode.window.showErrorMessage(`❌ An unknown error occurred while saving the file. See the console for details.`);
        }
    }
}

let activeCode: string | null = null;

export function activate(context: vscode.ExtensionContext) {
    // Command to enter a code
    let openCodeCommand = vscode.commands.registerCommand("echosave.openCode", async () => {
        const code = await vscode.window.showInputBox({ prompt: "Enter a code" });
        if (!code) {
            return;
        }

        activeCode = code; // Store active code
        vscode.window.showInformationMessage(`Active Code: ${code}`);

        // Fetch files from Supabase
        let files = await readStorage(code);

        const selectedFile = await vscode.window.showQuickPick(
            files.map(f => f.file_name).concat(["➕ Add File", "🗑️ Delete File", "🗑️ Delete Code Group"]),
            { placeHolder: files.length ? "Select a file to open or delete" : "No files found. Add one!" }
        );

        if (selectedFile === "➕ Add File") {
            let fileUri = await vscode.window.showOpenDialog({ canSelectMany: false });
            if (fileUri && fileUri[0]) {
                addFileToStorage(fileUri[0].fsPath, code);
            }
        } else if (selectedFile === "🗑️ Delete Code Group") {
            // Delete code group from Supabase
            await supabase.from('code_groups').delete().eq('code', code);
            activeCode = null;
            vscode.window.showInformationMessage("Code group deleted successfully.");
        } else if (selectedFile === "🗑️ Delete File") {
            const fileToDelete = await vscode.window.showQuickPick(files.map(f => f.file_name), { placeHolder: "Select a file to delete" });
            if (fileToDelete) {
                // Delete file from Supabase
                await supabase.from('code_groups').delete().eq('file_name', fileToDelete).eq('code', code);
                vscode.window.showInformationMessage(`Deleted '${fileToDelete}' from ${code}.`);
            }
        } else if (selectedFile) {
            openFileFromStorage(code, selectedFile);
        }
    });

    let addFileToCodeGroupCommand = vscode.commands.registerCommand("echosave.addFileToCodeGroup", async (fileuri: vscode.Uri) => {
        // Check if active code is set
        if (!activeCode) {
            vscode.window.showErrorMessage("❌ No active code group selected. Please select a code group first.");
            return;
        }

        const filePath = fileuri.fsPath;
        const fileName = path.basename(filePath);
        const fileContent = fs.readFileSync(filePath, "utf-8");

        // Add the file to the code group in Supabase
        await writeStorage(activeCode, fileName, fileContent);

        
    });

    context.subscriptions.push(openCodeCommand, addFileToCodeGroupCommand);
}

// Function to add a file to Supabase storage
async function addFileToStorage(filePath: string, code: string) {
    let fileName = path.basename(filePath);
    let fileContent = fs.readFileSync(filePath, "utf-8");

    await writeStorage(code, fileName, fileContent);  // Save to Supabase
}

// Function to open a file from Supabase storage
async function openFileFromStorage(code: string, fileName: string) {
    let files = await readStorage(code);
    let fileData = files.find(f => f.file_name === fileName);
    if (fileData) {
        let tempFilePath = path.join(vscode.workspace.rootPath || __dirname, fileData.file_name);
        fs.writeFileSync(tempFilePath, fileData.content, "utf-8");
        vscode.window.showTextDocument(vscode.Uri.file(tempFilePath));
    }
}

export function deactivate() {}
