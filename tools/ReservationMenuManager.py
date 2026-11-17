"""축제 당일 메뉴 편집·배포용 GUI. 외부 Python 패키지는 필요하지 않습니다."""

from __future__ import annotations

import os
import queue
import re
import shutil
import subprocess
import threading
from pathlib import Path
import tkinter as tk
from tkinter import filedialog, messagebox, scrolledtext


DEFAULT_REPOSITORY = Path(r"C:\Users\user\Documents\ChatGPT\학교\reservation")
ALLOWED_DIRTY = re.compile(r"^(?: M|M |MM|A |AM|\?\?) (?:public/js/menu\.js|functions/menu\.js)$")


class MenuManager(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title("복성고 예약 메뉴 관리")
        self.geometry("980x760")
        self.minsize(760, 600)
        self.events: queue.Queue[tuple[str, str]] = queue.Queue()
        self.busy = False
        self.loaded_text = ""

        self.repository = tk.StringVar(value=os.environ.get("RESERVATION_REPOSITORY", str(DEFAULT_REPOSITORY)))
        self._build()
        self.load_menu()
        self.after(100, self.consume_events)

    def _build(self) -> None:
        root = tk.Frame(self, padx=14, pady=12)
        root.pack(fill="both", expand=True)

        location = tk.Frame(root)
        location.pack(fill="x")
        tk.Label(location, text="저장소 경로").pack(side="left")
        tk.Entry(location, textvariable=self.repository).pack(side="left", fill="x", expand=True, padx=8)
        tk.Button(location, text="폴더 선택", command=self.choose_repository).pack(side="left")

        tk.Label(root, text="메뉴 설정  ·  한 줄 추가 예: menu('02', '라면', 2500, '설명', '🍜'),", anchor="w").pack(fill="x", pady=(12, 4))
        self.editor = scrolledtext.ScrolledText(root, undo=True, font=("Consolas", 11), wrap="none")
        self.editor.pack(fill="both", expand=True)

        controls = tk.Frame(root, pady=10)
        controls.pack(fill="x")
        self.load_button = tk.Button(controls, text="메뉴 다시 불러오기", command=self.load_menu)
        self.load_button.pack(side="left")
        self.check_button = tk.Button(controls, text="검사만 실행", command=lambda: self.start("check"))
        self.check_button.pack(side="left", padx=8)
        self.deploy_button = tk.Button(controls, text="저장 · GitHub 반영 · Firebase 배포", command=lambda: self.start("deploy"), bg="#176b45", fg="white")
        self.deploy_button.pack(side="right")

        tk.Label(root, text="실행 기록", anchor="w").pack(fill="x", pady=(4, 2))
        self.log = scrolledtext.ScrolledText(root, height=12, state="disabled", font=("Consolas", 10), wrap="word")
        self.log.pack(fill="both")
        self.status = tk.StringVar(value="준비됨")
        tk.Label(root, textvariable=self.status, anchor="w", fg="#185a3b").pack(fill="x", pady=(6, 0))

    def repo_path(self) -> Path:
        path = Path(self.repository.get().strip())
        if not (path / ".git").exists():
            raise RuntimeError("올바른 reservation Git 저장소 경로를 선택하세요.")
        return path

    def menu_path(self) -> Path:
        return self.repo_path() / "public" / "js" / "menu.js"

    def choose_repository(self) -> None:
        picked = filedialog.askdirectory(initialdir=self.repository.get())
        if picked:
            self.repository.set(picked)
            self.load_menu()

    def load_menu(self) -> None:
        if self.busy:
            return
        try:
            content = self.menu_path().read_text(encoding="utf-8")
        except Exception as error:
            messagebox.showerror("메뉴 불러오기 실패", str(error))
            return
        self.editor.delete("1.0", "end")
        self.editor.insert("1.0", content)
        self.loaded_text = content
        self.status.set("메뉴를 불러왔습니다. 수정 후 배포 버튼을 누르세요.")

    def append_log(self, text: str) -> None:
        self.log.configure(state="normal")
        self.log.insert("end", text.rstrip() + "\n")
        self.log.see("end")
        self.log.configure(state="disabled")

    def set_busy(self, value: bool) -> None:
        self.busy = value
        state = "disabled" if value else "normal"
        self.load_button.configure(state=state)
        self.check_button.configure(state=state)
        self.deploy_button.configure(state=state)

    def start(self, action: str) -> None:
        if self.busy:
            return
        try:
            repo = self.repo_path()
            current = self.editor.get("1.0", "end-1c")
            if current != self.loaded_text:
                (repo / "public" / "js" / "menu.js").write_text(current + "\n", encoding="utf-8")
                self.loaded_text = current + "\n"
                self.append_log("[메뉴 파일 저장됨]")
        except Exception as error:
            messagebox.showerror("저장 실패", str(error))
            return
        self.set_busy(True)
        self.status.set("처리 중… 창을 닫지 마세요.")
        threading.Thread(target=self.worker, args=(action,), daemon=True).start()

    def command(self, repo: Path, *args: str) -> str:
        self.events.put(("log", "> " + " ".join(args)))
        process = subprocess.Popen(args, cwd=repo, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
        output: list[str] = []
        assert process.stdout is not None
        for line in process.stdout:
            output.append(line)
            self.events.put(("log", line.rstrip()))
        if process.wait() != 0:
            raise RuntimeError(f"명령이 실패했습니다: {' '.join(args)}")
        return "".join(output)

    @staticmethod
    def executable(name: str) -> str:
        """Resolve Windows batch launchers such as npm.cmd before Popen runs."""
        if os.name == "nt":
            resolved = shutil.which(f"{name}.cmd") or shutil.which(name)
        else:
            resolved = shutil.which(name)
        if not resolved:
            raise RuntimeError(f"'{name}' 실행 파일을 찾을 수 없습니다. Node.js와 npm이 설치되어 있는지 확인하세요.")
        return resolved

    def git_status(self, repo: Path) -> list[str]:
        output = self.command(repo, "git", "status", "--porcelain")
        lines = [line for line in output.splitlines() if line]
        unexpected = [line for line in lines if not ALLOWED_DIRTY.match(line)]
        if unexpected:
            raise RuntimeError("메뉴 파일 이외의 미처리 변경이 있습니다. 먼저 정리하세요.\n" + "\n".join(unexpected))
        return lines

    def worker(self, action: str) -> None:
        try:
            repo = self.repo_path()
            initial = self.git_status(repo)
            self.command(repo, "git", "fetch", "origin")
            counts = self.command(repo, "git", "rev-list", "--left-right", "--count", "HEAD...origin/main").split()
            ahead, behind = int(counts[0]), int(counts[1])
            if behind and initial:
                raise RuntimeError("GitHub와 이 컴퓨터 양쪽에 메뉴 변경이 있습니다. 자동 병합하지 않았습니다.")
            if behind:
                self.command(repo, "git", "pull", "--ff-only", "origin", "main")
            if ahead:
                raise RuntimeError("이 컴퓨터에 아직 푸시되지 않은 커밋이 있습니다. Git 상태를 먼저 정리하세요.")

            npm = self.executable("npm")
            self.command(repo, npm, "run", "sync:menu")
            self.command(repo, npm, "run", "check")
            if action == "check":
                self.events.put(("done", "검사가 완료되었습니다. 배포는 수행하지 않았습니다."))
                return

            changes = self.git_status(repo)
            if not changes:
                self.events.put(("done", "메뉴 변경이 없습니다. 배포하지 않았습니다."))
                return
            self.command(repo, "git", "add", "--", "public/js/menu.js", "functions/menu.js")
            self.command(repo, "git", "commit", "-m", "Update reservation menu")
            self.command(repo, "git", "push", "origin", "main")
            npx = self.executable("npx")
            self.command(repo, npx, "firebase-tools", "deploy", "--only", "functions:reservation:createReservation,functions:reservation:getPublicSettings", "--project", "jw-astro09")
            self.events.put(("done", "완료: GitHub Pages와 Firebase 서버 메뉴를 함께 반영했습니다."))
        except Exception as error:
            self.events.put(("error", str(error)))

    def consume_events(self) -> None:
        try:
            while True:
                kind, message = self.events.get_nowait()
                if kind == "log":
                    self.append_log(message)
                elif kind == "done":
                    self.set_busy(False)
                    self.status.set(message)
                    self.load_menu()
                    messagebox.showinfo("완료", message)
                elif kind == "error":
                    self.set_busy(False)
                    self.status.set("오류가 발생했습니다.")
                    self.append_log("오류: " + message)
                    messagebox.showerror("배포 중단", message)
        except queue.Empty:
            pass
        self.after(100, self.consume_events)


if __name__ == "__main__":
    MenuManager().mainloop()
