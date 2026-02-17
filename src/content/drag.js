/**
 * drag.js
 * Handles draggable logic with boundary checks
 */

class DragHandler {
    static makeDraggable(element, handle) {
        let isDragging = false;
        let startX, startY, initialLeft, initialTop;

        handle.onmousedown = (e) => {
            // Ignore if clicking interactive elements inside header
            if (['SELECT', 'BUTTON', 'INPUT'].includes(e.target.tagName) || e.target.closest('.close-btn') || e.target.closest('.select-group')) return;

            e.preventDefault();
            isDragging = true;

            const rect = element.getBoundingClientRect();
            initialLeft = rect.left;
            initialTop = rect.top;
            startX = e.clientX;
            startY = e.clientY;

            // Disable transition for performance
            element.style.transition = 'none';
            element.classList.add('dragging');
            document.body.style.userSelect = 'none';

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        };

        const onMouseMove = (e) => {
            if (!isDragging) return;

            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            let newLeft = initialLeft + dx;
            let newTop = initialTop + dy;

            // Simple boundary check (keep somewhat on screen)
            const winW = window.innerWidth;
            const winH = window.innerHeight;
            const rect = element.getBoundingClientRect();

            if (newLeft < -rect.width + 50) newLeft = -rect.width + 50;
            if (newLeft > winW - 50) newLeft = winW - 50;
            if (newTop < 0) newTop = 0;
            if (newTop > winH - 50) newTop = winH - 50;

            element.style.left = `${newLeft}px`;
            element.style.top = `${newTop}px`;

            // Clear transform interfering with top/left
            element.style.transform = 'none';
        };

        const onMouseUp = () => {
            isDragging = false;
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);

            element.style.transition = ''; // Restore
            element.classList.remove('dragging');
            document.body.style.userSelect = '';
        };
    }
}

// Export to window for browser extension
window.DragHandler = DragHandler;
console.log('DragHandler class defined and exported to window');
