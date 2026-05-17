
const copyBtn = document.getElementById('copyBtn');
const miniCopyBtn = document.getElementById('miniCopyBtn');
const command = document.getElementById('command');
const langToggle = document.getElementById('langToggle');

let isBangla = false;

async function copyCommand(button){

    try{

        await navigator.clipboard.writeText(command.innerText);

        button.innerText = isBangla ? 'কপি হয়েছে!' : 'Copied!';

        setTimeout(() => {

            if(button.id === 'copyBtn'){
                button.innerText = isBangla ? 'কমান্ড কপি করুন' : 'Copy Run Command';
            }else{
                button.innerText = isBangla ? 'কমান্ড কপি করুন' : 'Copy Command';
            }

        }, 2000);

    }catch(e){

        alert('Copy failed');

    }

}

copyBtn.addEventListener('click', () => copyCommand(copyBtn));
miniCopyBtn.addEventListener('click', () => copyCommand(miniCopyBtn));

langToggle.addEventListener('click', () => {

    isBangla = !isBangla;

    document.body.classList.toggle('bn');

    document.querySelectorAll('[data-en]').forEach(el => {

        el.innerText = isBangla
            ? el.dataset.bn
            : el.dataset.en;

    });

    langToggle.innerText = isBangla ? 'English' : 'বাংলা';

});
