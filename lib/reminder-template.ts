/** Verified public homepage supplied for this portal. Never construct account-specific links. */
export const reminderPortalUrl="https://london-property-portal.vercel.app";
export type ReminderTemplate={subject:string;message:string};
export function readReminderTemplate(value:unknown):ReminderTemplate{
 if(!value||typeof value!=="object"||Array.isArray(value))throw Error("Saved template is invalid.");
 const template=value as ReminderTemplate;
 if(typeof template.subject!=="string"||!template.subject.trim()||template.subject.length>250||/[\r\n\0]/.test(template.subject)||typeof template.message!=="string"||!template.message.trim()||template.message.length>5000||template.message.includes("\0"))throw Error("Use a subject up to 250 characters and message up to 5,000 characters.");
 renderReminderTemplate(template.subject,{name:null,unit:"Unit",building:"Building"},true);
 renderReminderTemplate(template.message,{name:null,unit:"Unit",building:"Building"});
 return {subject:template.subject,message:template.message};
}
export function renderReminderTemplate(template:string,values:{name:string|null;unit:string;building:string},subject=false){
 const fields:Record<string,string>={name:values.name||"there",unit:values.unit,building:values.building,portal:reminderPortalUrl};
 // One pass only: braces in a recipient's actual name are literal, not nested placeholders.
 const rendered=template.replace(/\{([^{}]+)\}/g,(_match,key:string)=>{if(!Object.hasOwn(fields,key))throw Error(`Unknown template field {${key}}. Use {name}, {unit}, {building} or {portal}.`);return fields[key];});
 if(subject&&(/[\r\n\0]/.test(rendered)||rendered.length>1000))throw Error("Personalized subject is invalid or too long.");
 return rendered;
}

export const bulkReminderDefaults={
 overdue:{subject:"Service charge account reminder",message:"Hello {name},\n\nOur records show an overdue amount on your service charge account, as set out below. Please review the account details and contact the managing team if you have recently paid or believe anything is incorrect.\n\nYou can sign in to the property portal to review your account status: {portal}. If you cannot access it, please contact the managing team."},
 outstanding:{subject:"Service charge account balance",message:"Hello {name},\n\nPlease find your recorded service charge account balance below. Amounts with a future due date are not overdue and are not requested early. If you have recently paid or have a query, please contact the managing team.\n\nYou can sign in to the property portal to review your account status: {portal}. If you cannot access it, please contact the managing team."},
};
