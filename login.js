document.addEventListener("DOMContentLoaded", async () => {
  const form = document.getElementById("loginForm");
  const userInput = document.getElementById("user");
  const passInput = document.getElementById("pass");
  const errorBox = document.getElementById("err");
  const submitButton = document.getElementById("loginBtn");

  function showError(message) {
    errorBox.textContent = message;
    errorBox.classList.add("show");
  }

  function clearError() {
    errorBox.classList.remove("show");
    errorBox.textContent = "";
  }

  function setLoading(loading) {
    submitButton.disabled = loading;
    submitButton.textContent = loading ? "جاري الدخول..." : "دخول";
  }

  const session = await CleanTime.getSession();
  if (session) {
    window.location.href = CleanTime.pageForRole(session.role);
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearError();

    const username = userInput.value.trim();
    const password = passInput.value;

    if (!username || !password) {
      showError("يرجى إدخال اسم المستخدم وكلمة المرور");
      return;
    }

    setLoading(true);
    try {
      const data = await CleanTime.apiRequest("/api/auth/login", {
        method: "POST",
        allow401: true,
        body: { username, password },
      });
      window.location.href = CleanTime.pageForRole(data.user.role);
    } catch (error) {
      showError(error.message || "تعذر تسجيل الدخول");
      setLoading(false);
    }
  });
});
