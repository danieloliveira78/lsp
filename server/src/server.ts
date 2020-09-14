import { createConnection, ProposedFeatures, TextDocuments, TextDocumentSyncKind } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { LSPContext } from './lsp-context';
import { templatesInternos } from './lsp-internal-templates';
import { LSPParser } from './lsp-parser';

LSPContext.loadInternalTemplates(templatesInternos);

let connection = createConnection(ProposedFeatures.all);  // Criar a conexão com o LSP (Language Server Protocol)
let documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);  // Criar um gerenciador arquivos textos

documents.listen(connection); // Make the text document manager listen on the connection for open, change and close text document events

let workspaceFolder: string | null;
connection.onInitialize(
	(params) =>
	{
		workspaceFolder = params.rootUri;
		return {
			capabilities: {
				textDocumentSync: TextDocumentSyncKind.Incremental,
				// completionProvider: { resolveProvider: false, triggerCharacters: ['.'] },
				signatureHelpProvider: { triggerCharacters: ['(', ','] },
				// hoverProvider: true,
				// definitionProvider: true // TODO: Não implementado
			}
		};
	});

connection.listen();

LSPParser.initialise()
	.then(() =>
	{
		documents.onDidOpen(
			(evt) =>
			{
				let actionClass = LSPParser.parseFile(evt.document.uri, evt.document.getText(), true);
				LSPContext.registerClass(actionClass);
			});

		documents.onDidChangeContent(change => LSPContext.registerClass(LSPParser.parseFile(change.document.uri, change.document.getText(), true)));
		connection.onCompletion((docPos, token) => LSPContext.getCompletions(docPos, token));
		connection.onSignatureHelp((docPos, token) => LSPContext.getSignatureHelp(docPos, token, documents.get(docPos.textDocument.uri)));
		connection.onHover(docPos => LSPContext.getHoverInfo(docPos));
		// connection.onDefinition(docPos => LSPContext.getDefinition(docPos)); // TODO: Não implementado
	});