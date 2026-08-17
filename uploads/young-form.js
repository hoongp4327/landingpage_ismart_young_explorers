(() => {
  const initializeYoungForm = () => {
  const form = document.getElementById('youngExplorersForm');
  const done = document.getElementById('youngFormDone');
  const resetButton = document.getElementById('youngFormReset');
  const message = document.getElementById('youngFormMessage');

  if (!form || !done || !resetButton || !message) return false;
  if (form.dataset.youngFormReady === 'true') return true;
  form.dataset.youngFormReady = 'true';
  form.hidden = false;
  done.hidden = true;
  message.hidden = true;

  const REF_STORAGE_KEY = 'ismartYoungExplorersReferralCode';
  const REF_PATTERN = /^[a-z0-9_-]{2,40}$/;
  const endpoint = (form.dataset.endpoint || '').trim();

  const captureReferralCode = () => {
    const incomingRef = (new URLSearchParams(window.location.search).get('ref') || '')
      .trim()
      .toLowerCase();

    try {
      let savedRef = (window.localStorage.getItem(REF_STORAGE_KEY) || '')
        .trim()
        .toLowerCase();

      if (savedRef === 'direct') savedRef = '';

      // First-touch: chỉ lưu mã hợp lệ đầu tiên.
      if (!REF_PATTERN.test(savedRef) && REF_PATTERN.test(incomingRef)) {
        window.localStorage.setItem(REF_STORAGE_KEY, incomingRef);
        savedRef = incomingRef;
      }

      return REF_PATTERN.test(savedRef) ? savedRef : 'direct';
    } catch (error) {
      return REF_PATTERN.test(incomingRef) ? incomingRef : 'direct';
    }
  };

  const initialRefCode = captureReferralCode();
  form.dataset.refCode = initialRefCode;
  form.elements.refCode.value = initialRefCode;
  form.elements.refCode.setAttribute('value', initialRefCode);

  const rules = {
    parentName: value => value.trim().length >= 2,
    phone: value => /^(?:\+?84|0)\d{8,10}$/.test(value.replace(/[^\d+]/g, ''))
  };

  const validate = input => {
    const field = input.closest('.young-form-field');
    const isValid = rules[input.name](input.value);
    field.toggleAttribute('data-invalid', !isValid);
    input.setAttribute('aria-invalid', String(!isValid));
    return isValid;
  };

  Object.keys(rules).forEach(name => {
    const input = form.elements[name];
    input.addEventListener('blur', () => validate(input));
    input.addEventListener('input', () => {
      if (input.closest('.young-form-field').hasAttribute('data-invalid')) {
        validate(input);
      }
    });
  });

  const showError = text => {
    message.textContent = text;
    message.hidden = false;
  };

  form.addEventListener('submit', async event => {
    event.preventDefault();
    message.hidden = true;

    let firstInvalid = null;
    Object.keys(rules).forEach(name => {
      const input = form.elements[name];
      if (!validate(input) && !firstInvalid) firstInvalid = input;
    });

    if (firstInvalid) {
      firstInvalid.focus();
      return;
    }

    if (!/^https:\/\/script\.google\.com\/macros\/s\/[a-z0-9_-]+\/exec(?:\?.*)?$/i.test(endpoint)) {
      showError('Form đang chờ cấu hình đường dẫn Google Apps Script /exec.');
      return;
    }

    const submitButton = form.querySelector('button[type="submit"]');
    const originalButtonText = submitButton.textContent;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 15000);

    submitButton.disabled = true;
    submitButton.setAttribute('aria-busy', 'true');
    submitButton.textContent = 'Đang gửi thông tin...';

    try {
      const formData = new FormData(form);
      formData.set('refCode', captureReferralCode());
      formData.append('pageUrl', window.location.href);

      await fetch(endpoint, {
        method: 'POST',
        body: formData,
        mode: 'no-cors',
        signal: controller.signal
      });

      form.reset();
      form.hidden = true;
      done.hidden = false;
      done.focus();
    } catch (error) {
      showError(error.name === 'AbortError'
        ? 'Kết nối đang chậm. Vui lòng thử gửi lại.'
        : 'Không thể gửi thông tin. Vui lòng kiểm tra kết nối và thử lại.');
    } finally {
      window.clearTimeout(timeoutId);
      submitButton.disabled = false;
      submitButton.removeAttribute('aria-busy');
      submitButton.textContent = originalButtonText;
    }
  });

  resetButton.addEventListener('click', () => {
    done.hidden = true;
    form.hidden = false;
    form.reset();
    const refCode = captureReferralCode();
    form.dataset.refCode = refCode;
    form.elements.refCode.value = refCode;
    form.elements.refCode.setAttribute('value', refCode);
    message.hidden = true;
    form.elements.parentName.focus();
  });

  return true;
  };

  initializeYoungForm();

  // support.js can replace this section after the first render.
  // Keep observing so listeners are attached to any replacement form.
  const observer = new MutationObserver(() => initializeYoungForm());

  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
