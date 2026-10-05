import { useRef, useState } from 'react';
import { api } from './api.mjs';

const emptyForm = { email: '', name: '', subject: '', message: '' };

export default function EmailForm({ available = true }) {
  const [formData, setFormData] = useState(emptyForm);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const submitting = useRef(false);

  function handleChange(event) {
    const { name, value } = event.target;
    setFormData(previous => ({ ...previous, [name]: value }));
    setStatus(null);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting.current || !available) return;
    submitting.current = true;
    setLoading(true);
    setStatus(null);
    try {
      const result = await api('/send-email', { recipientEmail: formData.email,
        recipientName: formData.name, subject: formData.subject, message: formData.message });
      if (!result.success || !result.messageId) throw new Error('The email could not be confirmed. Please check before trying again.');
      setStatus({ type: 'success', message: 'Email accepted for sending!' });
      setFormData(emptyForm);
    } catch (error) {
      setStatus({ type: 'error', message: error.message });
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  }

  return <section className="form-card email-card" aria-labelledby="email-form-title">
    <p className="eyebrow">STAY IN TOUCH</p>
    <h1 id="email-form-title">Send Message via Brevo</h1>
    <p className="form-description">Choose a recipient and write your message.</p>
    {!available && <div className="notice info" role="status">Email delivery is temporarily unavailable. Please try again later.</div>}
    <form onSubmit={handleSubmit} aria-label="Send email">
      <fieldset disabled={loading || !available} className="email-fields">
        <legend className="sr-only">Email details</legend>
        <div className="field"><label htmlFor="recipient-name">Recipient name <small>(optional)</small></label>
          <input id="recipient-name" type="text" name="name" placeholder="Recipient name" value={formData.name} onChange={handleChange} maxLength={100} /></div>
        <div className="field"><label htmlFor="recipient-email">Recipient email <span aria-hidden="true">*</span></label>
          <input id="recipient-email" type="email" name="email" placeholder="recipient@example.com" value={formData.email} onChange={handleChange} maxLength={255} required /></div>
        <div className="field"><label htmlFor="email-subject">Subject <small>(optional)</small></label>
          <input id="email-subject" type="text" name="subject" placeholder="Hello from our WebApp" value={formData.subject} onChange={handleChange} maxLength={200} /></div>
        <div className="field"><label htmlFor="email-message">Message <span aria-hidden="true">*</span></label>
          <textarea id="email-message" name="message" placeholder="Your message" value={formData.message} onChange={handleChange} rows={6} maxLength={10000} required /></div>
        <button className="button primary full" type="submit">{loading ? 'Sending...' : 'Send Email'}</button>
      </fieldset>
    </form>
    {status && <div className={`notice ${status.type}`} role={status.type === 'error' ? 'alert' : 'status'}>{status.message}</div>}
  </section>;
}
