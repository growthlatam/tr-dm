import type { Metadata } from "next";

export const metadata: Metadata = { title: "Data deletion / Exclusão de dados | DM Automation" };

const contact = process.env.NEXT_PUBLIC_PRIVACY_CONTACT;

export default function DataDeletionPage() {
  const where = contact ? (
    <a className="text-accent underline" href={`mailto:${contact}`}>
      {contact}
    </a>
  ) : (
    "the person who manages the Thomson Reuters account you wrote to"
  );
  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-10 text-sm leading-relaxed text-text">
      <h1 className="text-2xl font-bold">Delete your data</h1>
      <p>To have the data we hold about you removed (your identifier, name or username, the messages and comments you sent us, and the tags we added), write to {where} from any channel and say &ldquo;delete my data&rdquo;, with your Instagram username or Facebook name so we can find you.</p>
      <p>We delete it from the tool and confirm back to you. If you only want to stop automated messages, send STOP in the conversation.</p>
      <hr className="border-border" />
      <h1 className="text-2xl font-bold">Excluir seus dados</h1>
      <p>Para remover os dados que temos sobre você (seu identificador, nome ou usuário, as mensagens e comentários que nos enviou e as etiquetas que aplicamos), escreva para {where} por qualquer canal dizendo &ldquo;excluir meus dados&rdquo;, com seu usuário do Instagram ou nome no Facebook para que possamos localizá-lo.</p>
      <p>Excluímos da ferramenta e confirmamos com você. Se você só quer parar as mensagens automáticas, envie PARAR na conversa.</p>
    </main>
  );
}
